import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";

import { logger } from "../logger.ts";
import { ErrorType } from "../errors.ts";
import type { Sql } from "../db/pool.ts";
import { createDbMetrics, dbMetricAttributes, type DbMetrics } from "../db/metrics.ts";

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Coarse namespace for telemetry/logs; never includes segment [1+] (tokens/codes/emails). */
export function keyNamespace(key: string[]): string {
  return key[0] ?? "";
}

export class PostgresStorage {
  private readonly SEPARATOR = String.fromCharCode(0x1f);
  private readonly tracer = trace.getTracer("issuer.postgres-storage");
  private readonly metrics: DbMetrics = createDbMetrics();

  constructor(private readonly sql: Sql) {}

  private flatKey(key: string[]): string {
    return key.join(this.SEPARATOR);
  }

  private async observe<T>(
    operation: string,
    action: (span: Span) => Promise<T>,
  ): Promise<T> {
    const attributes = dbMetricAttributes(operation);
    const start = performance.now();
    return this.tracer.startActiveSpan(
      `openauth_kv.${operation}`,
      async (span) => {
        try {
          const result = await action(span);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          this.metrics.operationErrorCounter.add(1, attributes);
          span.setAttribute("error.type", ErrorType.DB);
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
          this.metrics.operationCounter.add(1, attributes);
          this.metrics.operationDuration.record(
            (performance.now() - start) / 1000,
            attributes,
          );
          span.end();
        }
      },
    );
  }

  async get(key: string[]): Promise<Record<string, unknown> | undefined> {
    const keyPath = this.flatKey(key);
    const namespace = keyNamespace(key);
    return this.observe("get", async (span) => {
      span.setAttribute("db.key", namespace);
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
    const namespace = keyNamespace(key);
    try {
      await this.observe("set", async (span) => {
        span.setAttribute("db.key", namespace);
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
      logger.error(
        "OpenAuth storage set failed",
        err,
        {
          error_type: ErrorType.DB,
          db_key: namespace,
        },
      );
      throw err;
    }
  }

  async remove(key: string[]): Promise<void> {
    const keyPath = this.flatKey(key);
    const namespace = keyNamespace(key);
    await this.observe("remove", async (span) => {
      span.setAttribute("db.key", namespace);
      await this.sql`
        DELETE FROM openauth_kv WHERE key_path = ${keyPath}
      `;
    });
  }

  async *scan(prefix: string[]): AsyncIterable<[string[], unknown]> {
    const namespace = keyNamespace(prefix);
    const attributes = dbMetricAttributes("scan");
    const span = this.tracer.startSpan("openauth_kv.scan");
    span.setAttribute("db.prefix", namespace);
    const start = performance.now();
    try {
      const rows =
        prefix.length === 0
          ? await this.sql<{ key_path: string; value: unknown }[]>`
              SELECT key_path, value
              FROM openauth_kv
              WHERE expires_at IS NULL OR expires_at > now()
            `
          : await (async () => {
              const prefixStr = this.flatKey(prefix);
              const likePrefix = `${escapeLikePattern(prefixStr)}${this.SEPARATOR}%`;
              return this.sql<{ key_path: string; value: unknown }[]>`
                SELECT key_path, value
                FROM openauth_kv
                WHERE (key_path = ${prefixStr} OR key_path LIKE ${likePrefix} ESCAPE '\\')
                  AND (expires_at IS NULL OR expires_at > now())
              `;
            })();
      span.setStatus({ code: SpanStatusCode.OK });
      for (const row of rows) {
        const segments = row.key_path.split(this.SEPARATOR);
        yield [segments, row.value];
      }
    } catch (err: unknown) {
      this.metrics.operationErrorCounter.add(1, attributes);
      span.setAttribute("error.type", ErrorType.DB);
      if (err instanceof Error) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      } else {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      logger.error(
        "OpenAuth storage scan failed",
        err,
        {
          error_type: ErrorType.DB,
          db_prefix: namespace,
        },
      );
      throw err;
    } finally {
      this.metrics.operationCounter.add(1, attributes);
      this.metrics.operationDuration.record(
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
