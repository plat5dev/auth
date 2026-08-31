import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { issuer } from "@openauthjs/openauth";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import { PasswordUI } from "@openauthjs/openauth/ui/password";
import { metrics, trace, SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";

import { logger } from "./logger.ts";
import { ErrorKind } from "./errors.ts";
import { PostgresStorage } from "./storage/postgres.ts";
import { connect } from "./db/pool.ts";
import { migrate } from "./db/migrate.ts";
import { UsersStore } from "./db/users.ts";
import { subjects } from "./subjects.ts";
import { startTelemetry, shutdownTelemetry } from "./telemetry.ts";
import { startHealthServer } from "./health.ts";
import { createCorsHeaders } from "./cors.ts";
import { getSmtpFrom, getSmtpTransporter, smtpConfigured } from "./smtp.ts";
import { handleDevToken } from "./dev/token.ts";
import { applyPublicIssuerUrl } from "./public-issuer.ts";
import { loadTheme, verificationEmail } from "./theme.ts";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/static/logo.jpg": { file: "logo.jpg", type: "image/jpeg" },
  "/static/p5.jpg": { file: "p5.jpg", type: "image/jpeg" },
};

function envString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw : fallback;
}

const displayName = envString("AUTH_DISPLAY_NAME", "Plat5");
const theme = loadTheme({
  displayName,
  themeFile: process.env.AUTH_THEME_FILE,
});

await startTelemetry();

// Import after telemetry starts so meters are registered with the SDK
const { withHttpMetrics, normalizeRoute } = await import("./http-metrics.ts");
await import("./process-metrics.ts");

const sql = connect();
await migrate(sql);
const storage = new PostgresStorage(sql);
const usersStore = new UsersStore(sql);

const tracer = trace.getTracer("issuer.issuer");
const meter = metrics.getMeter("issuer.issuer");
const issuerLogger = logger.withScope("issuer");
const passwordLogger = issuerLogger.withScope("provider.password");

const authDecisionCounter = meter.createCounter("auth_decisions_total", {
  description: "Authorization decision outcomes per client",
});
const authSuccessCounter = meter.createCounter("auth_success_total", {
  description: "Successful authentications issued by issuer",
});
const authFailureCounter = meter.createCounter("auth_failures_total", {
  description: "Failed authentications processed by issuer",
});
const codeDispatchCounter = meter.createCounter("auth_password_codes_total", {
  description: "One-time password challenge codes generated",
});
const purgeExpiredCounter = meter.createCounter("auth_kv_purge_total", {
  description: "OpenAuth KV expired-row purge runs",
});
const isProd = process.env.DEPLOYMENT_ENV === "prod";

async function runPurgeExpired() {
  try {
    const removed = await storage.purgeExpired();
    purgeExpiredCounter.add(1, { outcome: "success" });
    if (removed > 0) {
      issuerLogger.info("Purged expired OpenAuth rows", { removed });
    }
  } catch (error) {
    purgeExpiredCounter.add(1, { outcome: "error" });
    issuerLogger.error("Failed to purge expired OpenAuth rows", error, {
      error: true,
      error_kind: ErrorKind.DB,
    });
  }
}

void runPurgeExpired();
const purgeInterval = setInterval(() => {
  void runPurgeExpired();
}, 60 * 60 * 1000);
purgeInterval.unref?.();

function csvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const allowedClients = csvEnv("AUTH_ALLOWED_CLIENTS", ["plat5"]);
const allowedRedirectURIs = csvEnv("AUTH_ALLOWED_REDIRECT_URIS", [
  "https://oauth.pstmn.io/v1/callback",
  "http://localhost:5173/callback",
]);
// Empty = no audience restriction. Non-empty = audience required and must match.
const allowedAudiences = csvEnv("AUTH_ALLOWED_AUDIENCES", []);
// Browser SPA origins for token refresh CORS. Empty until a client exists.
const allowedOrigins = csvEnv("AUTH_ALLOWED_ORIGINS", []);
const getCorsHeaders = createCorsHeaders(allowedOrigins);

async function getUser(provider: string, identifier: string): Promise<string> {
  return tracer.startActiveSpan("issuer.get_user", async (span) => {
    span.setAttributes({
      "auth.provider": provider,
    });

    try {
      const userId = await usersStore.getOrCreateUser(provider, identifier);
      span.setAttribute("user.id", userId);
      span.setStatus({ code: SpanStatusCode.OK });
      return userId;
    } catch (error) {
      span.recordException(error as Error);
      span.setAttribute("error", true);
      span.setAttribute("error.kind", ErrorKind.DB);
      span.setStatus({ code: SpanStatusCode.ERROR });
      issuerLogger.error("Failed to resolve user identifier", error, {
        error: true,
        error_kind: ErrorKind.DB,
        provider,
      });
      throw error;
    }
  });
}

const app = issuer({
  theme,
  ttl: {
    access: 60 * 60,
    refresh: 60 * 60 * 24 * 30,
  },
  subjects,
  storage,
  providers: {
    password: PasswordProvider(
      PasswordUI({
        sendCode: async (email, code) => {
          return tracer.startActiveSpan("issuer.password.send_code", async (span) => {
            const deliveryMethod = smtpConfigured() ? "email" : "log";
            span.setAttributes({
              "auth.delivery_method": deliveryMethod,
            });

            try {
              if (!smtpConfigured()) {
                if (isProd) {
                  throw new Error(
                    "SMTP_HOST, SMTP_USER, and SMTP_PASS must be set in prod",
                  );
                }
                codeDispatchCounter.add(1, { delivery_method: "log" });
                // Dev-only path: code must appear in logs when SMTP is unset.
                passwordLogger.info("Password challenge dispatched", {
                  delivery_method: "log",
                  code,
                });
                span.setStatus({ code: SpanStatusCode.OK });
                return;
              }

              const transporter = getSmtpTransporter();
              const from = getSmtpFrom();
              const mail = verificationEmail(displayName, code);
              await transporter.sendMail({
                from,
                to: email,
                subject: mail.subject,
                text: mail.text,
              });
              codeDispatchCounter.add(1, { delivery_method: "email" });
              passwordLogger.info("Password challenge dispatched", {
                delivery_method: "email",
              });
              span.setStatus({ code: SpanStatusCode.OK });
            } catch (error) {
              span.recordException(error as Error);
              span.setAttribute("error", true);
              span.setAttribute("error.kind", ErrorKind.Network);
              span.setStatus({ code: SpanStatusCode.ERROR });
              passwordLogger.error("Password challenge dispatch failed", error, {
                error: true,
                error_kind: ErrorKind.Network,
                delivery_method: deliveryMethod,
              });
              throw error;
            }
          });
        },
        validatePassword: (password) => {
          if (password.length < 8) {
            return "Password must be at least 8 characters";
          }
        },
      }),
    ),
  },
  allow: async (input) => {
    const { clientID, redirectURI, audience } = input;

    return tracer.startActiveSpan("issuer.allow", async (span) => {
      span.setAttributes({
        "auth.client_id": clientID,
        "auth.redirect_uri": redirectURI,
        "auth.audience": audience ?? "",
      });

      try {
        const clientAllowed = allowedClients.includes(clientID);
        const redirectAllowed = allowedRedirectURIs.includes(redirectURI);
        const audienceAllowed =
          allowedAudiences.length === 0 ||
          (typeof audience === "string" &&
            audience.length > 0 &&
            allowedAudiences.includes(audience));
        const allowed = clientAllowed && redirectAllowed && audienceAllowed;
        const outcome = allowed ? "allow" : "deny";

        authDecisionCounter.add(1, { outcome });
        span.setAttribute("auth.outcome", outcome);
        span.setAttribute("auth.client_allowed", clientAllowed);
        span.setAttribute("auth.redirect_allowed", redirectAllowed);
        span.setAttribute("auth.audience_allowed", audienceAllowed);

        if (!allowed) {
          issuerLogger.warn("Authorization request denied", {
            client_id: clientID,
            redirect_uri: redirectURI,
            audience: audience ?? "",
            client_allowed: clientAllowed,
            redirect_allowed: redirectAllowed,
            audience_allowed: audienceAllowed,
          });
        } else {
          issuerLogger.debug("Authorization request approved", {
            client_id: clientID,
            redirect_uri: redirectURI,
            audience: audience ?? "",
          });
        }

        span.setStatus({ code: SpanStatusCode.OK });
        return allowed;
      } catch (error) {
        span.recordException(error as Error);
        span.setAttribute("error", true);
        span.setAttribute("error.kind", ErrorKind.Internal);
        span.setStatus({ code: SpanStatusCode.ERROR });
        issuerLogger.error("Authorization allow handler failed", error, {
          error: true,
          error_kind: ErrorKind.Internal,
          client_id: clientID,
          redirect_uri: redirectURI,
        });
        throw error;
      }
    });
  },
  success: async (ctx, value) => {
    return tracer.startActiveSpan("issuer.success", async (span) => {
      span.setAttributes({
        "auth.provider": value.provider,
      });

      try {
        if (value.provider === "password") {
          const userId = await getUser(value.provider, value.email);
          const subject = { user_id: userId };
          authSuccessCounter.add(1, { provider: value.provider });
          issuerLogger.info("Authentication successful", {
            provider: value.provider,
            user_id: subject.user_id,
          });
          span.setStatus({ code: SpanStatusCode.OK });
          return ctx.subject("user", subject);
        }

        throw new Error("Invalid provider");
      } catch (error) {
        authFailureCounter.add(1, { provider: value.provider });
        span.recordException(error as Error);
        span.setAttribute("error", true);
        span.setAttribute("error.kind", ErrorKind.Auth);
        span.setStatus({ code: SpanStatusCode.ERROR });
        issuerLogger.error("Authentication flow failed", error, {
          error: true,
          error_kind: ErrorKind.Auth,
          provider: value.provider,
        });
        throw error;
      }
    });
  },
});

async function serveStatic(pathname: string): Promise<Response | null> {
  const entry = STATIC_FILES[pathname];
  if (!entry) return null;
  const file = Bun.file(join(PUBLIC_DIR, entry.file));
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(file, {
    headers: {
      "Content-Type": entry.type,
      "Cache-Control": "public, max-age=86400",
    },
  });
}

function applyHttpSpan(
  span: Span,
  method: string,
  path: string,
  route: string,
  requestId: string,
) {
  span.setAttributes({
    "http.request.method": method,
    "url.path": path,
    "http.route": route,
    request_id: requestId,
  });
}

function finishHttpSpan(span: Span, status: number) {
  span.setAttribute("http.response.status_code", status);
  if (status >= 500) {
    span.setAttribute("error.kind", ErrorKind.Internal);
    span.setStatus({ code: SpanStatusCode.ERROR, message: "" });
  }
}

async function handleRequest(request: Request, server?: unknown): Promise<Response> {
  const requestId = request.headers.get("X-Request-ID") || randomUUID();
  const start = performance.now();
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    const corsHeaders = getCorsHeaders(request);
    const headers = new Headers(corsHeaders);
    headers.set("X-Request-ID", requestId);
    return new Response(null, { status: 204, headers });
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const staticResponse = await serveStatic(url.pathname);
    if (staticResponse) {
      const headers = new Headers(staticResponse.headers);
      headers.set("X-Request-ID", requestId);
      return new Response(
        request.method === "HEAD" ? null : staticResponse.body,
        { status: staticResponse.status, headers },
      );
    }
  }

  const route = normalizeRoute(url.pathname);
  const spanName = `${request.method} ${route}`;

  // Dev-only mint: never registered when DEPLOYMENT_ENV=prod
  if (!isProd && url.pathname === "/dev/token") {
    return tracer.startActiveSpan(spanName, { kind: SpanKind.SERVER }, async (span) => {
      applyHttpSpan(span, request.method, url.pathname, route, requestId);
      try {
        const response = await handleDevToken(request, requestId, {
          storage,
          users: usersStore,
          allowedClients,
        });
        finishHttpSpan(span, response.status);
        issuerLogger.info("request completed", {
          request_id: requestId,
          route: url.pathname,
          method: request.method,
          status: response.status,
          duration_ms: performance.now() - start,
        });
        return response;
      } catch (error) {
        span.recordException(error as Error);
        finishHttpSpan(span, 500);
        issuerLogger.error("Dev token mint failed", error, {
          error: true,
          error_kind: ErrorKind.Internal,
          request_id: requestId,
          route: url.pathname,
          method: request.method,
          duration_ms: performance.now() - start,
        });
        return new Response(
          JSON.stringify({
            error: {
              code: "INTERNAL_ERROR",
              message: "An unexpected error occurred",
              request_id: requestId,
            },
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              "X-Request-ID": requestId,
            },
          },
        );
      }
    });
  }

  return tracer.startActiveSpan(spanName, { kind: SpanKind.SERVER }, async (span) => {
    applyHttpSpan(span, request.method, url.pathname, route, requestId);

    try {
      const response = await app.fetch(applyPublicIssuerUrl(request), server);

      finishHttpSpan(span, response.status);

      const corsHeaders = getCorsHeaders(request);
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }
      newHeaders.set("X-Request-ID", requestId);
      const finalResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });

      issuerLogger.info("request completed", {
        request_id: requestId,
        route: url.pathname,
        method: request.method,
        status: finalResponse.status,
        duration_ms: performance.now() - start,
      });

      return finalResponse;
    } catch (error) {
      span.recordException(error as Error);
      finishHttpSpan(span, 500);

      issuerLogger.error("HTTP request handler failed", error, {
        error: true,
        error_kind: ErrorKind.Internal,
        route: url.pathname,
        method: request.method,
        request_id: requestId,
        duration_ms: performance.now() - start,
      });

      const errorBody = JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
          request_id: requestId,
        },
      });

      const corsHeaders = getCorsHeaders(request);
      return new Response(errorBody, {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": requestId,
          ...corsHeaders,
        },
      });
    }
  });
}

const internalPort = Number(process.env.INTERNAL_PORT ?? "5001");
const healthServer = startHealthServer(internalPort, {
  storage,
  users: usersStore,
});

const port = Number(process.env.PORT ?? "5000");
const server = Bun.serve({
  port,
  fetch: withHttpMetrics(handleRequest),
});

issuerLogger.info("Issuer listening", { port: server.port, internal_port: healthServer.port });

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  issuerLogger.info("Shutting down", { signal });

  clearInterval(purgeInterval);

  try {
    server.stop(false);
  } catch (error) {
    issuerLogger.error("Error stopping HTTP server", error, {
      error: true,
      error_kind: ErrorKind.Internal,
    });
  }

  try {
    healthServer.stop(false);
  } catch (error) {
    issuerLogger.error("Error stopping health server", error, {
      error: true,
      error_kind: ErrorKind.Internal,
    });
  }

  try {
    await sql.end({ timeout: 5 });
  } catch (error) {
    issuerLogger.error("Error closing database pool", error, {
      error: true,
      error_kind: ErrorKind.DB,
    });
  }

  await shutdownTelemetry();
  process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    shutdown(signal).catch((err) => {
      console.error("Error during shutdown", err);
      process.exit(1);
    });
  });
}
