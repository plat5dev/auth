import { describe, expect, test } from "bun:test";
import { _test } from "./telemetry.ts";

const { exporterIncludesOtlp, envExporterList, normalizeEndpoint } = _test;

describe("exporterIncludesOtlp", () => {
  test("defaults", () => {
    expect(exporterIncludesOtlp(undefined, true)).toBe(true);
    expect(exporterIncludesOtlp(undefined, false)).toBe(false);
  });

  test("explicit lists", () => {
    expect(exporterIncludesOtlp(["otlp"], false)).toBe(true);
    expect(exporterIncludesOtlp(["otlp", "prometheus"], false)).toBe(true);
    expect(exporterIncludesOtlp(["prometheus"], true)).toBe(false);
    expect(exporterIncludesOtlp(["none"], true)).toBe(false);
    expect(exporterIncludesOtlp([], true)).toBe(false);
  });
});

describe("envExporterList", () => {
  test("parses comma list", () => {
    process.env.OTEL_METRICS_EXPORTER = " otlp , Prometheus ";
    expect(envExporterList("OTEL_METRICS_EXPORTER")).toEqual(["otlp", "prometheus"]);
    delete process.env.OTEL_METRICS_EXPORTER;
    expect(envExporterList("OTEL_METRICS_EXPORTER")).toBeUndefined();
  });
});

describe("normalizeEndpoint", () => {
  test("joins base and path", () => {
    expect(normalizeEndpoint("http://localhost:4318", "/v1/traces")).toBe(
      "http://localhost:4318/v1/traces",
    );
    expect(normalizeEndpoint("http://localhost:4318/", "/v1/metrics")).toBe(
      "http://localhost:4318/v1/metrics",
    );
    expect(normalizeEndpoint("http://localhost:4318/v1/traces", "/v1/traces")).toBe(
      "http://localhost:4318/v1/traces",
    );
  });
});
