# Issuer

Bun-based OAuth2/OIDC service for **Plat5 Auth**. Issues tokens and serves JWKS.

## Local development

Requires Bun and Postgres.

```bash
bun install

export DATABASE_URL=postgres://auth:auth@localhost:5432/auth?sslmode=disable

bun dev
bun start
tsc --noEmit
bun test
```

Entry point: `src/issuer.ts`

Login UI theme (logo, colors) is set in `issuer.ts` via OpenAuth `theme`. `AUTH_DISPLAY_NAME` is the UI title and the name in password-challenge email. `AUTH_LOGO_URL` / `AUTH_FAVICON_URL` override the bundled `/static/*` assets (`public/`). Bind-mount `public/` to replace files at the default paths.

Prefer compose from the Auth product root:

```bash
cd ../compose && docker compose up --build
```

## Storage

| Concern | Store |
|---------|--------|
| Users + identities | Postgres schema **`users`** (`DATABASE_URL`) |
| OpenAuth (codes, refresh, passwords, auto signing keys) | Postgres table **`users.openauth_kv`** |

User ids are **ULID**. JWT subject properties: `{ "user_id" }` → claim path `properties.user_id` for relying parties.

## Env

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Auth Postgres |
| `PORT` | Public OIDC (default `5000`) |
| `PUBLIC_ISSUER_URL` | Pin JWT `iss` + OIDC discovery (injected as `X-Forwarded-*` for OpenAuth) |
| `INTERNAL_PORT` | Health + `/metrics` (default `5001`) |
| `AUTH_ALLOWED_CLIENTS` | OAuth client IDs (default `plat5`) |
| `AUTH_ALLOWED_REDIRECT_URIS` | Redirect URIs |
| `AUTH_ALLOWED_AUDIENCES` | Optional audience allowlist (empty = any) |
| `AUTH_ALLOWED_ORIGINS` | Browser CORS origins |
| `AUTH_DISPLAY_NAME` | Login UI title + email copy (default `Plat5`) |
| `AUTH_LOGO_URL` | Login UI logo URL (default `/static/logo.jpg`) |
| `AUTH_FAVICON_URL` | Login UI favicon URL (default `/static/p5.jpg`) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Password challenge email (all three required to send; omit in dev → codes logged) |
| `DEPLOYMENT_ENV` / `OTEL_DEPLOYMENT_ENV` | Resource `deployment.environment`; `prod` disables `POST /dev/token` |
| `OTEL_SERVICE_NAME` | Resource `service.name` (default `issuer`) |
| `OTEL_SERVICE_NAMESPACE` | Resource `service.namespace` (default `auth`) |
| `OTEL_SERVICE_VERSION` | Resource `service.version` |
| `OTEL_SERVICE_INSTANCE_ID` | Resource `service.instance.id` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP base URL. Unset → no OTLP |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Optional full traces URL |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Optional full metrics URL |
| `OTEL_TRACES_EXPORTER` | `otlp` when endpoint set — include `otlp` to push traces |
| `OTEL_METRICS_EXPORTER` | default `otlp` when endpoint set; set `prometheus` to push-off; `/metrics` always on |
| `OTEL_METRIC_EXPORT_INTERVAL` | ms (OTLP metrics only) |
| `OTEL_TRACES_SAMPLER_RATIO` | Trace sampling ratio (default `1`) |
| `OTEL_SDK_DISABLED` | `true` → no OTLP; stdout + `/metrics` remain |

Dev mint (non-prod): `POST /dev/token` `{ "email" }` → JWT + `user_id`. See [`../docs/oidc-surface.md`](../docs/oidc-surface.md).

Full list: [`../docs/env.md`](../docs/env.md).

## Telemetry

Contract: [`../docs/telemetry.md`](../docs/telemetry.md).

| Signal | Path |
|--------|------|
| Logs | JSON stdout |
| Metrics scrape | Prometheus `/metrics` on `INTERNAL_PORT` |
| Traces | OTLP HTTP when endpoint set (default) |
| Metrics OTLP | On when endpoint set (default); set `OTEL_METRICS_EXPORTER=prometheus` to opt out |

```bash
# traces push + scrape metrics (no double count)
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318

# full OTLP push — do not also scrape /metrics into the same backend
# OTEL_METRICS_EXPORTER=prometheus  # opt out of metrics push
```

Health and `/metrics` are on the internal app (not request-traced).
