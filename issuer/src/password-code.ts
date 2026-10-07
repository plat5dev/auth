import { metrics, trace, SpanStatusCode } from "@opentelemetry/api";

import { ConfigError, ErrorKind } from "./errors.ts";
import { devModeEnabled } from "./dev/mode.ts";
import type { StructuredLogger } from "./logger.ts";

const tracer = trace.getTracer("issuer.issuer");
const meter = metrics.getMeter("issuer.issuer");
const codeDispatchCounter = meter.createCounter("auth_password_codes_total", {
  description: "One-time password challenge codes generated",
});

export const SMTP_REQUIRED_MESSAGE =
  "SMTP_HOST, SMTP_USER, and SMTP_PASS must be set to send login codes (AUTH_DEV_MODE=true logs them instead, for local dev only)";

export type SendCodeDeps = {
  smtpConfigured: () => boolean;
  sendEmail: (email: string, code: string) => Promise<void>;
  logger: Pick<StructuredLogger, "info" | "error">;
};

export type SendCode = (email: string, code: string) => Promise<void>;

/**
 * Delivers a one-time login code.
 * - SMTP fully configured: email it.
 * - SMTP incomplete + `AUTH_DEV_MODE=true`: log it (local dev only).
 * - SMTP incomplete otherwise: fail. The code is never logged.
 * `DEPLOYMENT_ENV` has no effect.
 */
export function createSendCode(
  env: Record<string, string | undefined>,
  deps: SendCodeDeps,
): SendCode {
  const devMode = devModeEnabled(env);
  return (email, code) =>
    tracer.startActiveSpan("issuer.password.send_code", async (span) => {
      const deliveryMethod = deps.smtpConfigured()
        ? "email"
        : devMode
          ? "log"
          : "none";
      span.setAttributes({
        "auth.delivery_method": deliveryMethod,
      });

      try {
        if (deliveryMethod === "none") {
          throw new ConfigError(SMTP_REQUIRED_MESSAGE);
        }

        if (deliveryMethod === "log") {
          codeDispatchCounter.add(1, { delivery_method: "log" });
          // AUTH_DEV_MODE only: lets local dev sign in without SMTP.
          deps.logger.info("Password challenge dispatched", {
            delivery_method: "log",
            code,
          });
          span.setStatus({ code: SpanStatusCode.OK });
          return;
        }

        await deps.sendEmail(email, code);
        codeDispatchCounter.add(1, { delivery_method: "email" });
        deps.logger.info("Password challenge dispatched", {
          delivery_method: "email",
        });
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        const kind = error instanceof ConfigError ? ErrorKind.Config : ErrorKind.Network;
        span.recordException(error as Error);
        span.setAttribute("error", true);
        span.setAttribute("error.kind", kind);
        span.setStatus({ code: SpanStatusCode.ERROR });
        deps.logger.error("Password challenge dispatch failed", error, {
          error: true,
          error_kind: kind,
          delivery_method: deliveryMethod,
        });
        throw error;
      } finally {
        span.end();
      }
    });
}
