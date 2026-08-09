import { ulid } from "ulid";
import { metrics, trace, SpanStatusCode } from "@opentelemetry/api";
import {
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_SYSTEM_NAME,
} from "@opentelemetry/semantic-conventions";
import type { Sql } from "./pool.ts";
import { SCHEMA } from "./pool.ts";
import { ErrorKind } from "../errors.ts";
import { logger } from "../logger.ts";

const tracer = trace.getTracer("issuer.users");
const usersLogger = logger.withScope("db.users");

export class UsersStore {
  // Instruments created at construct time (after startTelemetry) so they bind to the real MeterProvider.
  private readonly meter = metrics.getMeter("issuer.users");
  private readonly opCounter = this.meter.createCounter("db_operations_total", {
    description: "Total database operations executed by issuer users store",
  });
  private readonly opErrors = this.meter.createCounter("db_operation_errors_total", {
    description: "Total failed database operations in issuer users store",
  });
  private readonly opDuration = this.meter.createHistogram(
    "db_operation_duration_seconds",
    {
      description: "Duration of issuer users store operations",
      unit: "s",
      advice: {
        explicitBucketBoundaries: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      },
    },
  );

  constructor(private readonly sql: Sql) {}

  async ping(): Promise<void> {
    await this.sql`SELECT 1`;
  }

  /** Resolve or create user for provider+identifier. Returns ULID user id. */
  async getOrCreateUser(provider: string, identifier: string): Promise<string> {
    return tracer.startActiveSpan("users.get_or_create", async (span) => {
      const attrs = {
        [ATTR_DB_SYSTEM_NAME]: "postgresql",
        [ATTR_DB_OPERATION_NAME]: "get_or_create_user",
        "db.namespace": SCHEMA,
        "auth.provider": provider,
      };
      span.setAttributes(attrs);
      const start = performance.now();

      try {
        const existing = await this.sql<{ user_id: string }[]>`
          SELECT user_id FROM user_identities
          WHERE provider = ${provider} AND identifier = ${identifier}
          LIMIT 1
        `;
        if (existing[0]) {
          this.opCounter.add(1, { ...attrs, status: "success" });
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
              this.opCounter.add(1, { ...attrs, status: "success" });
              span.setAttribute("user.id", again[0].user_id);
              span.setStatus({ code: SpanStatusCode.OK });
              return again[0].user_id;
            }
          }
          throw insertErr;
        }

        this.opCounter.add(1, { ...attrs, status: "success" });
        span.setAttribute("user.id", userId);
        span.setStatus({ code: SpanStatusCode.OK });
        usersLogger.info("Created user", { user_id: userId, provider });
        return userId;
      } catch (error) {
        this.opErrors.add(1, attrs);
        this.opCounter.add(1, { ...attrs, status: "error" });
        span.setAttribute("error", true);
        span.setAttribute("error.kind", ErrorKind.DB);
        if (error instanceof Error) {
          span.recordException(error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        throw error;
      } finally {
        this.opDuration.record((performance.now() - start) / 1000, attrs);
      }
    });
  }
}
