import { ulid } from "ulid";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { Sql } from "./pool.ts";
import { createDbMetrics, dbMetricAttributes, type DbMetrics } from "./metrics.ts";
import { ErrorType } from "../errors.ts";
import { logger } from "../logger.ts";

export class UsersStore {
  // Instruments created at construct time (after startTelemetry) so they bind to the real providers.
  private readonly tracer = trace.getTracer("issuer.users");
  private readonly metrics: DbMetrics = createDbMetrics();

  constructor(private readonly sql: Sql) {}

  async ping(): Promise<void> {
    await this.sql`SELECT 1`;
  }

  /** Resolve or create user for provider+identifier. Returns ULID user id. */
  async getOrCreateUser(provider: string, identifier: string): Promise<string> {
    return this.tracer.startActiveSpan("users.get_or_create", async (span) => {
      const metricAttrs = dbMetricAttributes("get_or_create_user");
      span.setAttributes({
        ...metricAttrs,
        "auth.provider": provider,
      });
      const start = performance.now();

      try {
        const existing = await this.sql<{ user_id: string }[]>`
          SELECT user_id FROM user_identities
          WHERE provider = ${provider} AND identifier = ${identifier}
          LIMIT 1
        `;
        if (existing[0]) {
          span.setAttribute("user.id", existing[0].user_id);
          span.setStatus({ code: SpanStatusCode.OK });
          return existing[0].user_id;
        }

        const userId = ulid();
        const identityId = ulid();

        try {
          await this.sql.begin(async (tx) => {
            await tx`
              INSERT INTO users (id) VALUES (${userId})
            `;
            await tx`
              INSERT INTO user_identities (id, user_id, provider, identifier)
              VALUES (${identityId}, ${userId}, ${provider}, ${identifier})
            `;
          });
        } catch (insertErr) {
          const msg =
            insertErr instanceof Error ? insertErr.message : String(insertErr);
          if (msg.includes("23505") || msg.toLowerCase().includes("unique")) {
            const again = await this.sql<{ user_id: string }[]>`
              SELECT user_id FROM user_identities
              WHERE provider = ${provider} AND identifier = ${identifier}
              LIMIT 1
            `;
            if (again[0]) {
              span.setAttribute("user.id", again[0].user_id);
              span.setStatus({ code: SpanStatusCode.OK });
              return again[0].user_id;
            }
          }
          throw insertErr;
        }

        span.setAttribute("user.id", userId);
        span.setStatus({ code: SpanStatusCode.OK });
        logger.info("Created user", { user_id: userId, provider });
        return userId;
      } catch (error) {
        this.metrics.operationErrorCounter.add(1, metricAttrs);
        span.setAttribute("error.type", ErrorType.DB);
        if (error instanceof Error) {
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        throw error;
      } finally {
        this.metrics.operationCounter.add(1, metricAttrs);
        this.metrics.operationDuration.record((performance.now() - start) / 1000, metricAttrs);
        span.end();
      }
    });
  }
}
