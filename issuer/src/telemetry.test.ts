import { describe, expect, test } from "bun:test";

import { buildResource, parseSettings, TelemetryConfigError } from "./telemetry.ts";

describe("parseSettings", () => {
  test("nothing set: no destination, the defaults", () => {
    expect(parseSettings({})).toEqual({
      sdkDisabled: false,
      tracesExporters: undefined,
      metricsExporters: undefined,
      tracesUrl: undefined,
      metricsUrl: undefined,
      samplerRatio: 1,
      metricExportIntervalMs: 30_000,
    });
  });

  test("an empty variable is unset", () => {
    expect(
      parseSettings({
        OTEL_TRACES_EXPORTER: "",
        OTEL_EXPORTER_OTLP_ENDPOINT: " ",
        OTEL_SDK_DISABLED: "",
        OTEL_TRACES_SAMPLER_RATIO: "",
      }),
    ).toEqual(parseSettings({}));
  });

  test("the base endpoint gets each signal's path; a signal's own URL is used as is", () => {
    const s = parseSettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318/",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://m.example/push",
    });
    expect(s.tracesUrl).toBe("http://collector:4318/v1/traces");
    expect(s.metricsUrl).toBe("https://m.example/push");
    expect(
      parseSettings({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318/v1/traces" }).tracesUrl,
    ).toBe("http://c:4318/v1/traces");
  });

  test("valid values parse", () => {
    const s = parseSettings({
      OTEL_TRACES_EXPORTER: "otlp,none",
      OTEL_METRICS_EXPORTER: " otlp , Prometheus ",
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_TRACES_SAMPLER_RATIO: "0.25",
      OTEL_METRIC_EXPORT_INTERVAL: "5000",
      OTEL_SDK_DISABLED: "TRUE",
      OTEL_RESOURCE_ATTRIBUTES: "team=auth,region=eu",
    });
    expect(s.tracesExporters).toEqual(["otlp", "none"]);
    expect(s.metricsExporters).toEqual(["otlp", "prometheus"]);
    expect(s.samplerRatio).toBe(0.25);
    expect(s.metricExportIntervalMs).toBe(5000);
    expect(s.sdkDisabled).toBe(true);
  });

  test("a set but invalid value is an error naming the variable", () => {
    for (const [key, value] of [
      ["OTEL_TRACES_EXPORTER", "jaeger"],
      ["OTEL_TRACES_EXPORTER", "prometheus"],
      ["OTEL_METRICS_EXPORTER", "otlp,console"],
      ["OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"],
      ["OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "http/json"],
      ["OTEL_EXPORTER_OTLP_METRICS_PROTOCOL", "grpc"],
      ["OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4318"],
      ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "ftp://c/v1/traces"],
      ["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "not a url"],
      ["OTEL_TRACES_SAMPLER_RATIO", "1.5"],
      ["OTEL_TRACES_SAMPLER_RATIO", "half"],
      ["OTEL_METRIC_EXPORT_INTERVAL", "0"],
      ["OTEL_METRIC_EXPORT_INTERVAL", "soon"],
      ["OTEL_SDK_DISABLED", "yes"],
      ["OTEL_RESOURCE_ATTRIBUTES", "team"],
      ["OTEL_RESOURCE_ATTRIBUTES", "a=1,=2"],
    ] as const) {
      let error: unknown;
      try {
        parseSettings({ [key]: value });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(TelemetryConfigError);
      expect((error as Error).message).toStartWith(`${key} is ${JSON.stringify(value)}:`);
    }
  });
});

describe("buildResource", () => {
  const saved = process.env.OTEL_RESOURCE_ATTRIBUTES;

  test("defaults: issuer, auth, the build's version (dev here)", () => {
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;
    const attrs = buildResource({ HOSTNAME: "issuer-1" }).attributes;
    expect(attrs["service.name"]).toBe("issuer");
    expect(attrs["service.namespace"]).toBe("auth");
    expect(attrs["service.version"]).toBe("dev");
    expect(attrs["service.instance.id"]).toBe("issuer-1");
    expect(attrs["deployment.environment"]).toBe("development");
  });

  test("OTEL_RESOURCE_ATTRIBUTES overrides the defaults; a convenience variable overrides both", () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES =
      "service.version=1.2.3,service.namespace=edge,deployment.environment=staging";
    const attrs = buildResource({ OTEL_DEPLOYMENT_ENV: "prod", NODE_ENV: "production" })
      .attributes;
    expect(attrs["service.version"]).toBe("1.2.3");
    expect(attrs["service.namespace"]).toBe("edge");
    expect(attrs["deployment.environment"]).toBe("prod");
    expect(buildResource({ OTEL_SERVICE_VERSION: "9.9.9" }).attributes["service.version"]).toBe(
      "9.9.9",
    );
    if (saved === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES;
    else process.env.OTEL_RESOURCE_ATTRIBUTES = saved;
  });
});
