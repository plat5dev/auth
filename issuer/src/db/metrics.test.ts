import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { metrics, trace } from "@opentelemetry/api";
import {
  PrometheusExporter,
  PrometheusSerializer,
} from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { PostgresStorage } from "../storage/postgres.ts";
import type { Sql } from "./pool.ts";
import { UsersStore } from "./users.ts";

describe("unified DB metrics and span lifecycle", () => {
  let meterProvider: MeterProvider;
  let prometheus: PrometheusExporter;
  let spanExporter: InMemorySpanExporter;
  let tracerProvider: BasicTracerProvider;

  beforeEach(() => {
    metrics.disable();
    prometheus = new PrometheusExporter({ preventServerStart: true });
    meterProvider = new MeterProvider({ readers: [prometheus] });
    metrics.setGlobalMeterProvider(meterProvider);

    spanExporter = new InMemorySpanExporter();
    trace.disable();
    tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);
  });

  afterEach(async () => {
    metrics.disable();
    trace.disable();
    await meterProvider.shutdown();
    await tracerProvider.shutdown();
  });

  test("Prometheus output has single # HELP / # TYPE families across PostgresStorage and UsersStore, and spans end", async () => {
    let shouldFail = false;
    const fakeSql = ((strings: TemplateStringsArray) => {
      const q = strings.join("?");
      if (shouldFail) {
        return Promise.reject(new Error("boom"));
      }
      if (q.includes("FROM user_identities")) {
        return Promise.resolve([{ user_id: "01TESTUSERID00000000000000" }]);
      }
      return Promise.resolve([]);
    }) as unknown as Sql;

    const storage = new PostgresStorage(fakeSql);
    const users = new UsersStore(fakeSql);

    await storage.get(["oauth:code", "abc"]);
    await users.getOrCreateUser("password", "alice@example.com");

    shouldFail = true;
    await expect(storage.get(["oauth:code", "def"])).rejects.toThrow("boom");
    await expect(users.getOrCreateUser("password", "bob@example.com")).rejects.toThrow("boom");

    // Verify all 4 spans ended cleanly (2 storage + 2 users)
    const finished = spanExporter.getFinishedSpans();
    expect(finished.map((s) => s.name)).toEqual([
      "openauth_kv.get",
      "users.get_or_create",
      "openauth_kv.get",
      "users.get_or_create",
    ]);

    const { resourceMetrics } = await prometheus.collect();
    const text = new PrometheusSerializer("", false).serialize(resourceMetrics);
    const lines = text.split("\n");

    for (const metricName of [
      "db_operations_total",
      "db_operation_errors_total",
      "db_operation_duration_seconds",
    ]) {
      expect(
        lines.filter((line) => line.startsWith(`# HELP ${metricName} `)),
      ).toHaveLength(1);
      expect(
        lines.filter((line) => line.startsWith(`# TYPE ${metricName} `)),
      ).toHaveLength(1);
    }

    // Both success + error counted in db_operations_total; only errors in db_operation_errors_total
    expect(text).toMatch(
      /db_operations_total\{[^}]*db_system_name="postgresql",db_operation_name="get",db_namespace="users"[^}]*\} 2/,
    );
    expect(text).toMatch(
      /db_operation_errors_total\{[^}]*db_system_name="postgresql",db_operation_name="get",db_namespace="users"[^}]*\} 1/,
    );
    expect(text).toMatch(
      /db_operations_total\{[^}]*db_system_name="postgresql",db_operation_name="get_or_create_user",db_namespace="users"[^}]*\} 2/,
    );
    expect(text).toMatch(
      /db_operation_errors_total\{[^}]*db_system_name="postgresql",db_operation_name="get_or_create_user",db_namespace="users"[^}]*\} 1/,
    );
  });
});
