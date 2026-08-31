# Telemetry contract

Logs, traces, and metrics for Plat5 Auth. Auth does **not** ship a collector. Operators bring any OTLP-compatible collector (or scrape Prometheus) — Alloy, otel-collector, Grafana Cloud OTLP, etc.

## Standard (summary)

| Signal | Always | Opt-in |
|--------|--------|--------|
| **Logs** | JSON to **stdout** | — (no OTLP logs) |
| **Metrics scrape** | Prometheus **`/metrics`** on the internal port | — |
| **Traces OTLP** | — | When endpoint is set and traces exporter includes `otlp` |
| **Metrics OTLP** | — | When endpoint is set **and** metrics exporter includes `otlp` |

**Defaults when an OTLP endpoint is set:**

- Traces → OTLP on (`OTEL_TRACES_EXPORTER` unset defaults to `otlp`)
- Metrics → OTLP on (`OTEL_METRICS_EXPORTER` unset defaults to `otlp`)
- `/metrics` scrape → still on

Set `OTEL_METRICS_EXPORTER=prometheus` (or `none`) to push traces only and scrape metrics.

**Do not** scrape `/metrics` into the same backend you also feed via OTLP metrics for the same series.

## Configuration

Prefer standard OpenTelemetry environment variables for exporters and destinations.

### Destination

| Variable | Purpose |
|----------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector base URL (e.g. `http://localhost:4318`). Unset = no OTLP destination. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Optional full traces URL |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Optional full metrics URL |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | **`http/protobuf` only** (OTLP/HTTP). `grpc` is not supported. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Optional headers (e.g. Grafana Cloud auth). Honored by the OTLP exporter SDKs. |
| `OTEL_EXPORTER_OTLP_*_HEADERS` | Per-signal header overrides when needed |

Endpoint = **where** to send OTLP. When set, traces and metrics both default to OTLP push.

### Exporter selection

| Variable | Default | Meaning |
|----------|---------|---------|
| `OTEL_TRACES_EXPORTER` | `otlp` if endpoint set, else effectively `none` | OTLP traces only if value includes `otlp` **and** a traces destination exists. |
| `OTEL_METRICS_EXPORTER` | `otlp` if endpoint set | OTLP metrics only if value includes `otlp` **and** a metrics destination exists. `/metrics` stays up regardless. |
| `OTEL_SDK_DISABLED` | unset | `true` → no OTLP export. Stdout logs and `/metrics` remain. |

| `OTEL_METRICS_EXPORTER` | OTLP metrics | `/metrics` |
|------------------------|--------------|------------|
| unset (default) | on (needs endpoint) | on |
| `otlp` | on (needs endpoint) | on |
| `otlp,prometheus` | on | on |
| `prometheus` | off | on |
| `none` | off | on |

`none` means no metrics **push**, not “disable scrape.”

### Resource identity

**Standard OTel** ([SDK env spec](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/)):

| Variable | Purpose |
|----------|---------|
| `OTEL_SERVICE_NAME` | Resource `service.name` (compose default: `issuer`). Takes precedence over the same key in `OTEL_RESOURCE_ATTRIBUTES`. |
| `OTEL_RESOURCE_ATTRIBUTES` | Comma-separated `key=value` resource attributes |

Example:

```bash
OTEL_SERVICE_NAME=issuer
OTEL_RESOURCE_ATTRIBUTES=service.namespace=auth,service.version=1.2.3,service.instance.id=issuer-1,deployment.environment=dev
```

**Project convenience** (not dedicated OTel env vars; issuer also reads these and maps them onto the same resource attributes):

| Variable | Maps to | Compose default |
|----------|---------|-----------------|
| `OTEL_SERVICE_NAMESPACE` | `service.namespace` | `auth` |
| `OTEL_SERVICE_VERSION` | `service.version` | optional |
| `OTEL_SERVICE_INSTANCE_ID` | `service.instance.id` | `HOSTNAME` fallback |
| `DEPLOYMENT_ENV` / `OTEL_DEPLOYMENT_ENV` | `deployment.environment` | optional |

If both `OTEL_RESOURCE_ATTRIBUTES` and a convenience var set the same attribute, the convenience var wins. Prefer `OTEL_RESOURCE_ATTRIBUTES` for portable operator config; convenience vars are fine for compose defaults.

`DEPLOYMENT_ENV=prod` also disables `POST /dev/token` (not only a resource attribute).

### Other

| Variable | Purpose |
|----------|---------|
| `OTEL_TRACES_SAMPLER_RATIO` | Trace sampling ratio when used |
| `OTEL_METRIC_EXPORT_INTERVAL` | OTLP metric export interval (ms) |

Default compose does **not** set `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Operator recipes

### Full OTLP push

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
# traces + metrics OTLP on by default when endpoint is set
# Do not also scrape /metrics into the same metrics backend
```

### Traces push + metrics scrape (no double count)

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_METRICS_EXPORTER=prometheus   # opt out of metrics push
```

### Scrape only

Leave endpoint unset. Scrape `/metrics`. Collect stdout logs in the platform.

### Local all-in-one

```bash
docker run --rm -p 3000:3000 -p 4317:4317 -p 4318:4318 \
  --name otel-lgtm grafana/otel-lgtm:latest
```

Host apps: `http://localhost:4318`. Containers → host collector: `http://host.docker.internal:4318`.

## Logs

Write **JSON** to stdout always. No OTLP log export.

| Field | Description |
|-------|-------------|
| `timestamp` | ISO8601 |
| `level` | debug, info, warn, error |
| `message` | Log message |
| `route` | HTTP route pattern |
| `method` | HTTP method |
| `status` | HTTP status code |
| `duration_ms` | Request duration |
| `request_id` | Correlation ID when present |
| `trace_id` / `span_id` | When a span is active |

### Error fields (5xx only)

| Field | Description |
|-------|-------------|
| `error_kind` | `auth`, `network`, `db`, `io`, `internal`, `validation` |
| `error_message` | Human-readable message |

Do not include `error_kind` for 4xx.

## Traces

- Export via **OTLP** only.
- Propagate **W3C Trace Context** only (no Baggage).
- Resource attributes: `service.name`, `service.namespace`, `service.instance.id`, `service.version`, `deployment.environment`.

### HTTP server spans

[HTTP span conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/) for the names we emit. Do **not** emit deprecated names (`http.method`, `http.status_code`, `http.target`, `http.url`, `http.scheme`). Do **not** dual-write old and new.

| | |
|---|---|
| Kind | `SERVER` |
| Name | `{method} {http.route}` when a route template exists; otherwise `{method}` only. Never the raw URI. |
| Attributes | `http.request.method`, `url.path`, `http.route` (template only, when matched), `http.response.status_code` (when known) |
| Status | Unset on 4xx. `Error` on 5xx with **no** description. Unset on 1xx/2xx/3xx unless a non-HTTP error occurred. |

`http.route` is the matched template. Do not put the raw path there. `url.path` is the actual path.

Do not set `url.query`, `url.scheme`, or `error.type`.

### Plat5 span attributes (not HTTP semconv)

- `request_id` on HTTP request spans (if present). Do not rename it to `request.id`.
- `error.kind` on **error spans** (5xx only): `auth`, `network`, `db`, `io`, `internal`, `validation`
- 4xx responses are normal business outcomes — do not set `error.kind` and do not mark the span as failed
- Record exceptions via `span.recordException(err)`
- High-cardinality identity (`client_id`, `redirect_uri`, user identifiers) belongs on **spans and logs**, not metric labels

## Metrics

### Scrape (always)

Expose Prometheus text format at **`/metrics`** on the **internal** port (not public ingress).

### OTLP (opt-in)

When a metrics destination is set and `OTEL_METRICS_EXPORTER` is unset or includes `otlp`, push the same logical series via OTLP.

### Cardinality

**Never** put high-cardinality values in metric labels (user IDs, request IDs, emails, `client_id`, `redirect_uri`). Those belong on spans and logs.

### Naming

- `snake_case`
- Prefix by domain: `http_`, `db_`, `process_`, `auth_`
- Suffix by type: `_total`, `_seconds`, `_bytes`

| Metric | Type | Labels |
|--------|------|--------|
| `http_requests_total` | Counter | route, method, status |
| `http_request_duration_seconds` | Histogram | route, method |
| `db_operations_total` | Counter | db_system_name, db_operation_name, db_namespace |
| `db_operation_errors_total` | Counter | db_system_name, db_operation_name, db_namespace |
| `db_operation_duration_seconds` | Histogram | db_system_name, db_operation_name, db_namespace |

**Histogram buckets** (same across all services):

| Metric | Boundaries (seconds) |
|--------|----------------------|
| `http_request_duration_seconds` | `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5` |
| `db_operation_duration_seconds` | `0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1` |

Do not include `service_name` / `service_namespace` in metric series if your collector already adds them from resource attributes or container labels.

### Process metrics (minimum)

Always emit on the scrape path:

| Metric | Notes |
|--------|--------|
| `process_resident_memory_bytes` | RSS |
| `process_cpu_seconds_total` | Cumulative user+system CPU |
| `process_start_time_seconds` | Unix epoch start time |

Extra process/runtime series are optional.

## Container labels (optional)

| Label | Value |
|-------|--------|
| `service.name` | `issuer` |
| `service.namespace` | `auth` |
| `metrics.port` | internal metrics port |
| `metrics.path` | `/metrics` (default) |

## Non-goals

- Shipping or requiring a collector / Alloy config as part of the product
- OTLP log export from apps
- App push to Loki, Tempo, or Mimir **native** APIs
- Public exposure of `/metrics`
- Custom non-`OTEL_*` env vars as the primary telemetry API

## References

- [OTel SDK environment variables](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/)
- [OTLP exporter configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/)
- [HTTP span semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [Semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
- [grafana/otel-lgtm](https://github.com/grafana/docker-otel-lgtm)
