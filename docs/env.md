# Environment variables

## issuer

| Variable | Purpose | Default / notes |
|----------|---------|-----------------|
| `DATABASE_URL` | Postgres for users + OpenAuth storage | Required |
| `INTERNAL_PORT` | Internal health + `/metrics` (not public OIDC) | `5001` |
| `PUBLIC_ISSUER_URL` | Pins JWT `iss` and OIDC discovery to this origin (OpenAuth 0.4.3 has no `issuer:` option; the issuer injects `X-Forwarded-*` so `getRelativeUrl` uses it). Also used by `POST /dev/token`. Set this when the request origin is the container hostname, otherwise `iss` is the container origin and relying-party `AUTH_ISSUER` checks 401. | Optional; trailing slash stripped |
| `AUTH_ALLOWED_CLIENTS` | OAuth client IDs (comma-separated) | `plat5` |
| `AUTH_ALLOWED_REDIRECT_URIS` | Redirect URI allowlist | Code default: Postman + localhost. Prod compose interpolates unset to empty string → empty allowlist → deny all `/authorize`. Required in production. |
| `AUTH_ALLOWED_ORIGINS` | Browser CORS origins | See code defaults |
| `AUTH_DISPLAY_NAME` | Password-challenge email copy, and login UI title when `AUTH_THEME_FILE` omits `title` | `Plat5` |
| `AUTH_THEME_FILE` | Optional path to an OpenAuth Theme JSON object. Passed to `issuer({ theme })`. Omit = bundled light theme + `/static/*`. Missing file or invalid JSON fails startup. | unset |
| `SMTP_HOST` | Password-challenge SMTP host | Required when sending email (no default). BYO provider or host-published MTA |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` / `SMTP_PASS` | SMTP auth | With `SMTP_HOST`, enables email; if any missing and not prod → codes logged; prod fails closed without full SMTP |
| `SMTP_FROM` | From address | `noreply@plat5.test` |
| `SMTP_TLS_INSECURE` | Skip TLS verify (local only) | |
| `OTEL_*` / `DEPLOYMENT_ENV` | See [`telemetry.md`](telemetry.md) | `prod` disables `/dev/token` |

## Password challenge delivery

| Mode | When | Behavior |
|------|------|----------|
| Log | `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` incomplete, `DEPLOYMENT_ENV` ≠ `prod` | Code logged on issuer |
| Email | `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` set | Sent via SMTP |
| Error | Prod without full SMTP | Startup/send fails closed |

## Compose

| Variable | Default |
|----------|---------|
| `AUTH_VERSION` | Image tag for `ghcr.io/plat5dev/auth` (prod compose; from this repo’s `v*` tags) |
| `POSTGRES_USER` | `auth` |
| `POSTGRES_PASSWORD` | (set in prod) |
| `POSTGRES_DB` | `auth` |
