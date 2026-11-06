import {
  context,
  diag,
  DiagLogLevel,
  metrics,
  propagation,
  trace,
  type DiagLogger,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { setGlobalErrorHandler, W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  defaultResource,
  detectResources,
  envDetector,
  resourceFromAttributes,
  type Resource,
} from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from "@opentelemetry/semantic-conventions";
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAMESPACE,
} from "@opentelemetry/semantic-conventions/incubating";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import {
  PrometheusExporter,
  PrometheusSerializer,
} from "@opentelemetry/exporter-prometheus";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { hostname } from "node:os";

import { logger } from "./logger.ts";
import { version } from "./version.ts";

type Env = Record<string, string | undefined>;

/**
 * The telemetry variables, parsed strictly: a variable that is set but invalid
 * is an error naming it (Plat5's telemetry contract, Invalid values). An empty
 * variable is unset.
 */
export interface TelemetrySettings {
  sdkDisabled: boolean;
  /** Undefined when unset: the default applies. */
  tracesExporters: string[] | undefined;
  metricsExporters: string[] | undefined;
  tracesUrl: string | undefined;
  metricsUrl: string | undefined;
  samplerRatio: number;
  metricExportIntervalMs: number;
}

export class TelemetryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelemetryConfigError";
  }
}

export function parseSettings(env: Env = process.env): TelemetrySettings {
  const sdkDisabled = envBool(env, "OTEL_SDK_DISABLED");
  for (const key of [
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
    "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
  ]) {
    const value = get(env, key);
    if (value !== undefined && value !== "http/protobuf") {
      throw invalid(key, value, "only http/protobuf is supported");
    }
  }
  const tracesExporters = exporterList(env, "OTEL_TRACES_EXPORTER", ["otlp", "none"]);
  const metricsExporters = exporterList(env, "OTEL_METRICS_EXPORTER", [
    "otlp",
    "prometheus",
    "none",
  ]);
  const samplerRatio = number(
    env,
    "OTEL_TRACES_SAMPLER_RATIO",
    1,
    (n) => n >= 0 && n <= 1,
    "want a number from 0 to 1",
  );
  const metricExportIntervalMs = number(
    env,
    "OTEL_METRIC_EXPORT_INTERVAL",
    30_000,
    (n) => n > 0,
    "want a positive number of milliseconds",
  );
  checkResourceAttributes(env);
  const base = endpoint(env, "OTEL_EXPORTER_OTLP_ENDPOINT");
  const tracesUrl =
    endpoint(env, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ??
    (base === undefined ? undefined : joinPath(base, "/v1/traces"));
  const metricsUrl =
    endpoint(env, "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ??
    (base === undefined ? undefined : joinPath(base, "/v1/metrics"));
  return {
    sdkDisabled,
    tracesExporters,
    metricsExporters,
    tracesUrl,
    metricsUrl,
    samplerRatio,
    metricExportIntervalMs,
  };
}

function get(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function invalid(key: string, value: string, want: string): TelemetryConfigError {
  return new TelemetryConfigError(`${key} is ${JSON.stringify(value)}: ${want}`);
}

function envBool(env: Env, key: string): boolean {
  const value = get(env, key);
  if (value === undefined) return false;
  switch (value.toLowerCase()) {
    case "true":
      return true;
    case "false":
      return false;
    default:
      throw invalid(key, value, "want true or false");
  }
}

function exporterList(env: Env, key: string, allowed: string[]): string[] | undefined {
  const value = get(env, key);
  if (value === undefined) return undefined;
  const parts = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  for (const part of parts) {
    if (!allowed.includes(part)) {
      throw invalid(key, value, `want a comma-separated list of ${allowed.join(", ")}`);
    }
  }
  return parts.length > 0 ? parts : undefined;
}

function number(
  env: Env,
  key: string,
  fallback: number,
  ok: (n: number) => boolean,
  want: string,
): number {
  const value = get(env, key);
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !ok(n)) {
    throw invalid(key, value, want);
  }
  return n;
}

function endpoint(env: Env, key: string): string | undefined {
  const value = get(env, key);
  if (value === undefined) return undefined;
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !url.host) {
    throw invalid(key, value, "want an http:// or https:// URL");
  }
  return value;
}

function checkResourceAttributes(env: Env): void {
  const value = get(env, "OTEL_RESOURCE_ATTRIBUTES");
  if (value === undefined) return;
  for (const entry of value.split(",")) {
    const eq = entry.indexOf("=");
    if (eq < 0 || entry.slice(0, eq).trim() === "") {
      throw invalid("OTEL_RESOURCE_ATTRIBUTES", value, "want key=value entries, comma-separated");
    }
  }
}

/** The base endpoint plus a signal's path, unless the base already ends with it. */
function joinPath(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return trimmed.endsWith(path) ? trimmed : `${trimmed}${path}`;
}

/** Traces and metrics push by default (OTLP when a destination exists). */
function includesOtlp(list: string[] | undefined): boolean {
  return list === undefined || list.includes("otlp");
}

/**
 * The resource, in layers: Auth's defaults (the build's version among them),
 * then OTEL_RESOURCE_ATTRIBUTES and OTEL_SERVICE_NAME, then the convenience
 * variables that are set.
 */
export function buildResource(env: Env = process.env): Resource {
  const defaults = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "issuer",
    [ATTR_SERVICE_NAMESPACE]: "auth",
    [ATTR_SERVICE_VERSION]: version || "dev",
    [ATTR_SERVICE_INSTANCE_ID]: get(env, "HOSTNAME") ?? hostname(),
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: get(env, "NODE_ENV") ?? "development",
  });
  const overrides: Record<string, string> = {};
  for (const [attribute, keys] of [
    [ATTR_SERVICE_NAMESPACE, ["OTEL_SERVICE_NAMESPACE"]],
    [ATTR_SERVICE_VERSION, ["OTEL_SERVICE_VERSION"]],
    [ATTR_SERVICE_INSTANCE_ID, ["OTEL_SERVICE_INSTANCE_ID"]],
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT, ["OTEL_DEPLOYMENT_ENV", "DEPLOYMENT_ENV"]],
  ] as const) {
    for (const key of keys) {
      const value = get(env, key);
      if (value !== undefined) {
        overrides[attribute] = value;
        break;
      }
    }
  }
  return defaultResource()
    .merge(defaults)
    .merge(detectResources({ detectors: [envDetector] }))
    .merge(resourceFromAttributes(overrides));
}

/** OpenTelemetry's own messages, a failed export among them, as JSON log lines. */
const diagLogger: DiagLogger = {
  error: (message, ...args) =>
    logger.error("telemetry error", undefined, diagFields(message, args)),
  warn: (message, ...args) => logger.warn("telemetry warning", diagFields(message, args)),
  info: (message, ...args) => logger.info("telemetry info", diagFields(message, args)),
  debug: (message, ...args) => logger.debug("telemetry debug", diagFields(message, args)),
  verbose: (message, ...args) => logger.debug("telemetry debug", diagFields(message, args)),
};

function diagFields(message: string, args: unknown[]): { error_message: string } {
  const parts = [message, ...args.map(describe)];
  return { error_message: parts.join(" ") };
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let tracerProvider: BasicTracerProvider | undefined;
let meterProvider: MeterProvider | undefined;
let prometheus: PrometheusExporter | undefined;
const serializer = new PrometheusSerializer("", false);

/**
 * Starts telemetry per docs/telemetry.md. Throws a TelemetryConfigError naming
 * the first telemetry variable that is set but invalid.
 *
 * - traces → OTLP when a destination exists and OTEL_TRACES_EXPORTER is unset or includes otlp
 * - metrics → OTLP likewise with OTEL_METRICS_EXPORTER
 * - /metrics scrape → always
 * - W3C Trace Context propagation, always
 */
export function startTelemetry(env: Env = process.env): void {
  const settings = parseSettings(env);
  const resource = buildResource(env);

  diag.setLogger(diagLogger, DiagLogLevel.WARN);
  setGlobalErrorHandler((err) => {
    logger.error("telemetry error", undefined, { error_message: describe(err) });
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const enableTraces =
    !settings.sdkDisabled &&
    settings.tracesUrl !== undefined &&
    includesOtlp(settings.tracesExporters);
  const enableMetricsOtlp =
    !settings.sdkDisabled &&
    settings.metricsUrl !== undefined &&
    includesOtlp(settings.metricsExporters);

  if (enableTraces) {
    tracerProvider = new BasicTracerProvider({
      resource,
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(settings.samplerRatio),
      }),
      spanProcessors: [
        new BatchSpanProcessor(new OTLPTraceExporter({ url: settings.tracesUrl })),
      ],
    });
    trace.setGlobalTracerProvider(tracerProvider);
  }

  prometheus = new PrometheusExporter({ preventServerStart: true });
  const readers: MetricReader[] = [prometheus];
  if (enableMetricsOtlp) {
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: settings.metricsUrl }),
        exportIntervalMillis: settings.metricExportIntervalMs,
      }),
    );
  }
  meterProvider = new MeterProvider({ resource, readers });
  metrics.setGlobalMeterProvider(meterProvider);
}

export async function shutdownTelemetry(): Promise<void> {
  const results = await Promise.allSettled([
    tracerProvider?.shutdown(),
    meterProvider?.shutdown(),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error("telemetry shutdown failed", result.reason);
    }
  }
}

/** Prometheus text for internal GET /metrics. */
export async function collectMetricsText(): Promise<string> {
  if (!prometheus) {
    return "# no registered metrics\n";
  }
  const { resourceMetrics, errors } = await prometheus.collect();
  if (errors.length > 0) {
    logger.error("prometheus metrics collection failed", undefined, {
      error_type: "internal",
      error_message: errors.map(describe).join("; "),
    });
  }
  return serializer.serialize(resourceMetrics);
}
