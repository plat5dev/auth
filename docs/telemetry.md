# Telemetry

Plat5 Auth follows Plat5's [telemetry conventions](https://github.com/plat5dev/plat5/blob/master/docs/reference/telemetry.md): stdout JSON logs, Prometheus `/metrics` on `INTERNAL_PORT` (default `5001`), and opt-in OTLP traces/metrics via standard `OTEL_*` environment variables. Auth does not ship a collector.

## Resource defaults

| Attribute | Default |
|-----------|---------|
| `service.name` | `issuer` |
| `service.namespace` | `auth` |
| `service.version` | Build `VERSION` arg (`dev` without one) |
| `service.instance.id` | `HOSTNAME`, else host name |
| `deployment.environment` | `NODE_ENV`, else `development` |

Override with standard `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`. Invalid `OTEL_*` values fail boot naming the variable.

## Auth metrics

In addition to HTTP (`http_requests_total`, `http_request_duration_seconds`), DB, and process metrics:

| Metric | Type | Labels |
|--------|------|--------|
| `auth_decisions_total` | Counter | `outcome` (`allow`, `deny`) |
| `auth_success_total` | Counter | `provider` |
| `auth_failures_total` | Counter | `provider` |
| `auth_password_codes_total` | Counter | `delivery_method` (`email`, `log`) |
| `auth_kv_purge_total` | Counter | `outcome` (`success`, `error`) |

Route labels use an allowlist of known issuer paths (unknown paths collapse to `unmatched`). High-cardinality values (`client_id`, `redirect_uri`, user ids) stay on logs and spans, never metric labels.
