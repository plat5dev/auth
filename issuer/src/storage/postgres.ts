import { metrics, trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import {
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_SYSTEM_NAME,
} from "@opentelemetry/semantic-conventions";

import { logger } from "../logger.ts";
import { ErrorKind } from "../errors.ts";
import type { Sql } from "../db/pool.ts";
import { SCHEMA } from "../db/pool.ts";

const storageLogger = logger.withScope("storage.postgres");

export class PostgresStorage {
  private readonly SEPARATOR = String.fromCharCode(0x1f);
  private readonly tracer = trace.getTracer("issuer.postgres-storage");
  private readonly meter = metrics.getMeter("issuer.postgres-storage");
  private readonly operationCounter = this.meter.createCounter(
    "db_operations_total",
    {
      description: "Total OpenAuth storage operations executed by issuer",
    },
  );
  private readonly operationErrorCounter = this.meter.createCounter(
    "db_operation_errors_total",
    {
      description:
        "Total failed OpenAuth storage operations executed by issuer",
    },
  );
  private readonly operationDuration = this.meter.createHistogram(
    "db_operation_duration_seconds",
    {
      description:
        "Duration of OpenAuth storage operations executed by issuer",
      unit: "s",
      advice: {
        explicitBucketBoundaries: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      },
    },
  );

  constructor(private readonly sql: Sql) {}

  private buildAttributes(operation: string) {
    return {
      [ATTR_DB_SYSTEM_NAME]: "postgresql",
      [ATTR_DB_OPERATION_NAME]: operation,
      [ATTR_DB_NAMESPACE]: SCHEMA,
    };
  }

  private flatKey(key: string[]): string {
    return key.join(this.SEPARATOR);
  }

  private async observe<T>(
    operation: string,
    action: (span: Span) => Promise<T>,
  ): Promise<T> {
    const attributes = this.buildAttributes(operation);
    const start = performance.now();
    return this.tracer.startActiveSpan(
      `openauth_kv.${operation}`,
      async (span) => {
        try {
          const result = await action(span);
          this.operationCounter.add(1, attributes);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          this.operationErrorCounter.add(1, attributes);
          span.setAttribute("error", true);
          span.setAttribute("error.kind", ErrorKind.DB);
          if (error instanceof Error) {
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } else {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
          throw error;
        } finally {
          this.operationDuration.record(
            (performance.now() - start) / 1000,
            attributes,
          );
        }
      },
    );
  }

  async get(key: string[]): Promise<Record<string, unknown> | undefined> {
    const keyPath = this.flatKey(key);
    return this.observe("get", async (span) => {
      span.setAttribute("db.key", keyPath);
      const rows = await this.sql`
        SELECT value
        FROM openauth_kv
        WHERE key_path = ${keyPath}
          AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) {
        return undefined;
      }
      return row.value as Record<string, unknown>;
    });
  }

  async set(key: string[], value: unknown, expiry?: Date): Promise<void> {
    const keyPath = this.flatKey(key);
    try {
      await this.observe("set", async (span) => {
        span.setAttribute("db.key", keyPath);
        const expiresAt = expiry ?? null;
        await this.sql`
          INSERT INTO openauth_kv (key_path, value, expires_at, updated_at)
          VALUES (${keyPath}, ${this.sql.json(value as never)}, ${expiresAt}, now())
          ON CONFLICT (key_path) DO UPDATE SET
            value = EXCLUDED.value,
            expires_at = EXCLUDED.expires_at,
            updated_at = now()
        `;
      });
    } catch (err: unknown) {
      storageLogger.error(
        "OpenAuth storage set failed",
        err instanceof Error ? err : undefined,
        {
          error: true,
          error_kind: ErrorKind.DB,
          db_key: keyPath,
        },
      );
      throw err;
    }
  }

  async remove(key: string[]): Promise<void> {
    const keyPath = this.flatKey(key);
    await this.observe("remove", async (span) => {
      span.setAttribute("db.key", keyPath);
      await this.sql`
        DELETE FROM openauth_kv WHERE key_path = ${keyPath}
      `;
    });
  }

  async *scan(prefix: string[]): AsyncIterable<[string[], unknown]> {
    const prefixStr = this.flatKey(prefix);
    const likePrefix = `${prefixStr}%`;
    storageLogger.info("OpenAuth storage scan started", {
      db_prefix: prefixStr,
    });
    const attributes = this.buildAttributes("scan");
    const span = this.tracer.startSpan("openauth_kv.scan");
    span.setAttribute("db.prefix", prefixStr);
    const start = performance.now();
    try {
      const rows = await this.sql`
        SELECT key_path, value
        FROM openauth_kv
        WHERE key_path LIKE ${likePrefix}
          AND (expires_at IS NULL OR expires_at > now())
      `;
      this.operationCounter.add(1, attributes);
      span.setStatus({ code: SpanStatusCode.OK });
      for (const row of rows) {
        const keyPath = row.key_path as string;
        const segments = keyPath.split(this.SEPARATOR);
        yield [segments, row.value];
      }
    } catch (err: unknown) {
      this.operationErrorCounter.add(1, attributes);
      span.setAttribute("error", true);
      span.setAttribute("error.kind", ErrorKind.DB);
      if (err instanceof Error) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      } else {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      storageLogger.error(
        "OpenAuth storage scan failed",
        err instanceof Error ? err : undefined,
        {
          error: true,
          error_kind: ErrorKind.DB,
          db_prefix: prefixStr,
        },
      );
      throw err;
    } finally {
      this.operationDuration.record(
        (performance.now() - start) / 1000,
        attributes,
      );
      span.end();
    }
  }

  /** Drop expired OpenAuth rows (codes, refresh, short-lived state). */
  async purgeExpired(): Promise<number> {
    return this.observe("purge_expired", async () => {
      const rows = await this.sql`
        DELETE FROM openauth_kv
        WHERE expires_at IS NOT NULL AND expires_at <= now()
        RETURNING 1
      `;
      return rows.length;
    });
  }
}

export default PostgresStorage;
