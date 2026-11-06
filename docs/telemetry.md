# Telemetry

Plat5 Auth follows Plat5's [telemetry contract](https://github.com/plat5dev/plat5/blob/master/docs/reference/telemetry.md): the `OTEL_*` variables and the values they accept, logs, traces, metric naming and buckets, process metrics, and what's out of scope. Auth does **not** ship a collector. This doc holds only what is Auth's own.

## Signals

| Signal | Where |
|--------|-------|
| Logs | JSON on stdout, always |
| Metrics scrape | Prometheus `/metrics` on `INTERNAL_PORT` (default `5001`), never the public port |
| Traces and metrics push | OTLP/HTTP (`http/protobuf`) when an endpoint is set, as the contract's exporter selection says |

The internal port's health checks and `/metrics` have no spans and no request lines.

## Resource

| Attribute | Default |
|-----------|---------|
| `service.name` | `issuer` |
| `service.namespace` | `auth` |
| `service.version` | The build's `VERSION` argument; `dev` without one. The release workflow builds with the tag (e.g. `v0.2.3`), CI with `ci` |
| `service.instance.id` | `HOSTNAME`, else the host's name |
| `deployment.environment` | `NODE_ENV` (the image sets `production`), else `development` |

The variables that override these are the contract's. `DEPLOYMENT_ENV` changes no auth behavior ([`env.md`](env.md)).

Defaults Auth picks where the contract leaves them open: `OTEL_TRACES_SAMPLER_RATIO` is `1`, `OTEL_METRIC_EXPORT_INTERVAL` is `30000` ms.

## Logs

Each request on the public port, other than CORS preflights and the static files, writes one line: `request completed`, or `request failed` when the issuer threw. It carries `request_id` (the `X-Request-ID` header, else a new UUID), `route`, `method`, `status` and `duration_ms`. `route` is the [route](#routes) the path matched, or `unmatched`. A 5xx is an `error` line and adds `error_type`, and `error_message` when the issuer threw.

Other lines carry what they're about: `provider`, `user_id`, `client_id`, `redirect_uri`, `audience` and `delivery_method` on sign-in lines; `code` on a dev-mode login code. An error line with an exception adds its `stack`.

What OpenAuth writes to the console becomes a log line too: a protocol error is an `info` line, `OAuth error response`, with `oauth_error`; its own request log is dropped, since the request line covers it. A Postgres notice is a `debug` line.

`error_type` values Auth uses: `auth` (a sign-in failed), `network` (a login code email failed), `db`, and `internal` for anything else, a missing SMTP configuration included.

## Traces

HTTP server spans are as the contract says, with:

- `http.route` the [route](#routes) the path matched. An unmatched path has no `http.route`, and its span is named `{method}`.
- `url.scheme` the scheme of the request the issuer received. Behind a TLS-terminating proxy, that's `http`.
- An incoming `traceparent` is the span's parent.

Internal spans cover the sign-in (`issuer.allow`, `issuer.success`, `issuer.get_user`, `issuer.password.send_code`, with its `auth.*` attributes) and the stores (`openauth_kv.*`, `users.get_or_create`). A failed one has `error.type` and status `Error`.

## Metrics

### Routes

`route` labels, request lines and `http.route` use this allowlist of the paths the issuer serves. Any other path is `unmatched`: one series for probes and 404s, not one per URL.

`/authorize`, `/token`, `/dev/token`, `/.well-known/jwks.json`, `/.well-known/oauth-authorization-server`, `/static/wordmark.svg`, `/static/wordmark-dark.svg`, `/static/favicon.svg`, `/static/inter-latin.woff2`, and `/{provider}/authorize`, `/{provider}/callback`, `/{provider}/verify`, `/{provider}/register`, `/{provider}/change`.

### Auth's series

On top of the contract's `http_*`, `db_*` and `process_*` series:

| Metric | Type | Labels |
|--------|------|--------|
| `auth_decisions_total` | Counter | outcome (`allow`, `deny`) |
| `auth_success_total` | Counter | provider |
| `auth_failures_total` | Counter | provider |
| `auth_password_codes_total` | Counter | delivery_method (`email`, `log`) |
| `auth_kv_purge_total` | Counter | outcome (`success`, `error`) |

`client_id`, `redirect_uri` and user ids are on spans and logs, never metric labels.

## Container labels

| Label | Value |
|-------|-------|
| `service.name` | `issuer` |
| `service.namespace` | `auth` |
| `metrics.port` | `INTERNAL_PORT` |
| `metrics.path` | `/metrics` |
