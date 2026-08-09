import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  detectResources,
  envDetector,
  resourceFromAttributes,
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
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  PrometheusExporter,
  PrometheusSerializer,
} from "@opentelemetry/exporter-prometheus";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { hostname } from "node:os";

const serviceVersion =
  process.env.OTEL_SERVICE_VERSION ??
  process.env.AUTH_ISSUER_VERSION ??
  process.env.npm_package_version ??
  "0.0.0";
const serviceNamespace = process.env.OTEL_SERVICE_NAMESPACE ?? "auth";
const instanceId =
  process.env.OTEL_SERVICE_INSTANCE_ID ?? process.env.HOSTNAME ?? hostname();
const deploymentEnvironment =
  process.env.OTEL_DEPLOYMENT_ENV ??
  process.env.DEPLOYMENT_ENV ??
  process.env.NODE_ENV ??
  "development";

// Env detector first (OTEL_RESOURCE_ATTRIBUTES); convenience attrs win on collision.
const resource = detectResources({ detectors: [envDetector] }).merge(
  resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? "issuer",
    [ATTR_SERVICE_NAMESPACE]: serviceNamespace,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_SERVICE_INSTANCE_ID]: instanceId,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment,
  }),
);

diag.setLogger(new DiagConsoleLogger(), getDiagLevel());

let sdk: NodeSDK | undefined;
let started = false;
let prometheus: PrometheusExporter | undefined;
const serializer = new PrometheusSerializer("", false);

/**
 * Init OTel per auth/docs/telemetry.md.
 *
 * Defaults when an OTLP destination is set:
 * - traces → OTLP on (unless OTEL_TRACES_EXPORTER excludes otlp)
 * - metrics OTLP → on when dest exists (OTEL_METRICS_EXPORTER unset defaults to otlp)
 * - /metrics scrape → always on (PrometheusExporter; independent of OTLP)
 */
export async function startTelemetry() {
  if (started) {
    return;
  }

  if (!sdk) {
    try {
      sdk = buildSdk();
    } catch (err) {
      console.error("Failed to build OpenTelemetry SDK", err);
      throw err;
    }
  }

  try {
    sdk.start();
    started = true;
  } catch (err) {
    console.error("Failed to start OpenTelemetry SDK", err);
    throw err;
  }
}

export async function shutdownTelemetry() {
  if (!sdk || !started) {
    return;
  }
  try {
    await sdk.shutdown();
  } catch (err) {
    console.error("Error shutting down OpenTelemetry SDK", err);
  } finally {
    started = false;
  }
}

/** Prometheus text for internal GET /metrics. */
export async function collectMetricsText(): Promise<string> {
  if (!prometheus) {
    return "# no registered metrics\n";
  }
  const { resourceMetrics, errors } = await prometheus.collect();
  if (errors.length > 0) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "prometheus metrics collection errors",
        error_kind: "internal",
        error_message: errors.map(String).join("; "),
      }),
    );
  }
  return serializer.serialize(resourceMetrics);
}

function buildSdk(): NodeSDK {
  const sdkDisabled = envTruthy("OTEL_SDK_DISABLED");
  const tracesUrl = resolveOtlpUrl("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "/v1/traces");
  const metricsUrl = resolveOtlpUrl("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "/v1/metrics");

  const enableTraces =
    !sdkDisabled &&
    tracesUrl !== undefined &&
    exporterIncludesOtlp(envExporterList("OTEL_TRACES_EXPORTER"), true);
  const enableMetricsOtlp =
    !sdkDisabled &&
    metricsUrl !== undefined &&
    exporterIncludesOtlp(envExporterList("OTEL_METRICS_EXPORTER"), true);

  prometheus = new PrometheusExporter({ preventServerStart: true });

  const metricReaders: Array<
    PrometheusExporter | PeriodicExportingMetricReader
  > = [prometheus];

  if (enableMetricsOtlp && metricsUrl) {
    metricReaders.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: metricsUrl }),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 30_000),
      }),
    );
  }

  const ratio = Math.min(
    1,
    Math.max(0, Number(process.env.OTEL_TRACES_SAMPLER_RATIO ?? 1)),
  );

  const spanProcessors = enableTraces && tracesUrl
    ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: tracesUrl }))]
    : [];

  return new NodeSDK({
    resource,
    spanProcessors,
    sampler: enableTraces
      ? new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(ratio),
        })
      : undefined,
    metricReaders,
  });
}

function resolveOtlpUrl(specificEnv: string, defaultPath: string): string | undefined {
  const specific = process.env[specificEnv]?.trim();
  if (specific) {
    return specific;
  }
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!base) {
    return undefined;
  }
  return normalizeEndpoint(base, defaultPath);
}

function normalizeEndpoint(base: string, suffix: string): string {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  if (trimmedBase.endsWith(normalizedSuffix)) {
    return trimmedBase;
  }
  return `${trimmedBase}${normalizedSuffix}`;
}

/** Returns undefined when unset (caller applies defaults). */
function envExporterList(key: string): string[] | undefined {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return undefined;
  }
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/** Traces and metrics default when unset = true (otlp when dest exists). */
function exporterIncludesOtlp(
  list: string[] | undefined,
  defaultWhenUnset: boolean,
): boolean {
  if (list === undefined) {
    return defaultWhenUnset;
  }
  return list.includes("otlp");
}

function envTruthy(key: string): boolean {
  return process.env[key]?.trim().toLowerCase() === "true";
}

function getDiagLevel() {
  const level = (process.env.OTEL_DIAGNOSTIC_LOG_LEVEL ?? "error").toLowerCase();
  switch (level) {
    case "all":
      return DiagLogLevel.ALL;
    case "debug":
      return DiagLogLevel.DEBUG;
    case "info":
      return DiagLogLevel.INFO;
    case "warn":
    case "warning":
      return DiagLogLevel.WARN;
    case "error":
    default:
      return DiagLogLevel.ERROR;
  }
}

export const _test = {
  exporterIncludesOtlp,
  envExporterList,
  resolveOtlpUrl,
  normalizeEndpoint,
};
