import { ErrorType } from "./errors.ts";
import { logger } from "./logger.ts";
import { collectMetricsText } from "./telemetry.ts";

const startTime = Date.now();

interface HealthCheck {
  postgres_ready?: boolean;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  uptime_ms: number;
  checks: HealthCheck;
}

export interface HealthDeps {
  checkReady: () => Promise<unknown>;
  collectMetrics?: () => Promise<string>;
}

async function checkPostgres(deps: HealthDeps): Promise<boolean> {
  try {
    await deps.checkReady();
    return true;
  } catch {
    return false;
  }
}

async function getHealthResponse(deps: HealthDeps): Promise<HealthResponse> {
  const postgresReady = await checkPostgres(deps);

  return {
    status: postgresReady ? "healthy" : "unhealthy",
    uptime_ms: Date.now() - startTime,
    checks: {
      postgres_ready: postgresReady,
    },
  };
}

function getLiveResponse(): HealthResponse {
  return {
    status: "healthy",
    uptime_ms: Date.now() - startTime,
    checks: {},
  };
}

export function createHealthHandler(deps: HealthDeps) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/health/live") {
      const health = getLiveResponse();
      return new Response(JSON.stringify(health), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/health/ready") {
      const health = await getHealthResponse(deps);
      const status = health.status === "healthy" ? 200 : 503;
      return new Response(JSON.stringify(health), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/metrics") {
      try {
        const body = await (deps.collectMetrics ?? collectMetricsText)();
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          },
        });
      } catch (error) {
        logger.error("Failed to collect metrics", error, {
          error_type: ErrorType.Internal,
        });
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  };
}

export function startHealthServer(port: number, deps: HealthDeps) {
  const server = Bun.serve({
    port,
    fetch: createHealthHandler(deps),
  });

  logger.info("Health server started", { port: server.port });
  return server;
}
