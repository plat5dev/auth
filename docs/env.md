# Environment variables

## issuer

| Variable | Purpose | Default / notes |
|----------|---------|-----------------|
| `DATABASE_URL` | Postgres for users + OpenAuth storage | Required |
| `PORT` | Public OIDC / Auth UI port | `5000` |
| `INTERNAL_PORT` | Internal health + `/metrics` (not public OIDC) | `5001` |
| `PUBLIC_ISSUER_URL` | Pins JWT `iss` and OIDC discovery to this origin (OpenAuth 0.4.3 has no `issuer:` option; the issuer injects `X-Forwarded-*` so `getRelativeUrl` uses it). Also used by `POST /dev/token` when enabled. Set this when the request origin is the container hostname, otherwise `iss` is the container origin and relying-party `AUTH_ISSUER` checks 401. | Optional; trailing slash stripped |
| `AUTH_ALLOWED_CLIENTS` | OAuth client IDs (comma-separated) | `plat5` |
| `AUTH_ALLOWED_REDIRECT_URIS` | Redirect URI allowlist | Code default: Postman + localhost. Prod compose interpolates unset to empty string → empty allowlist → deny all `/authorize`. Required in production. |
| `AUTH_ALLOWED_AUDIENCES` | Audience allowlist checked on `/authorize` | Empty = any audience. Non-empty = `audience` required and must match |
| `AUTH_ALLOWED_ORIGINS` | Browser CORS origins | Empty (no CORS headers) |
| `AUTH_DISPLAY_NAME` | Password-challenge email copy, and login UI title when `AUTH_THEME_FILE` omits `title` | `Plat5` |
| `AUTH_THEME_FILE` | Optional path to an OpenAuth Theme JSON object. Passed to `issuer({ theme })`. Omit = bundled light theme + `/static/*`. Missing file or invalid JSON fails startup. | unset |
| `SMTP_HOST` | Password-challenge SMTP host | Required when sending email (no default). BYO provider or host-published MTA |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` / `SMTP_PASS` | SMTP auth | With `SMTP_HOST`, enables email. If any is missing, sending a code fails, unless `AUTH_DEV_MODE=true` (then the code is logged) |
| `SMTP_FROM` | From address | `noreply@plat5.test` |
| `SMTP_TLS_INSECURE` | Skip TLS verify (local only) | Only `true` skips |
| `AUTH_DEV_MODE` | Enables the dev-only conveniences: the `POST /dev/token` mint ([`oidc-surface.md`](oidc-surface.md#dev-only-token-mint)), and logging login codes when SMTP is incomplete. Both let anyone sign in as **any** email, so never enable it in production. Logs a warning at boot when on | Off. Only the exact string `true` enables it. Dev compose sets it; prod compose does not |
| `OTEL_*` / `DEPLOYMENT_ENV` | See [`telemetry.md`](telemetry.md). Telemetry only; `DEPLOYMENT_ENV` does not change auth behavior | — |

## Password challenge delivery

| Mode | When | Behavior |
|------|------|----------|
| Email | `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` set | Sent via SMTP. The code is never logged |
| Log | SMTP incomplete and `AUTH_DEV_MODE=true` | Code logged on issuer (local dev only) |
| Error | SMTP incomplete, `AUTH_DEV_MODE` not `true` | Sending the code fails and the code is not logged. There is no startup check, so the issuer boots and fails on the first code |

This is the same in every environment; `DEPLOYMENT_ENV` has no effect.

## Compose

| Variable | Default |
|----------|---------|
| `AUTH_VERSION` | Image tag for `ghcr.io/plat5dev/auth` (prod compose; from this repo’s `v*` tags) |
| `POSTGRES_USER` | `auth` |
| `POSTGRES_PASSWORD` | (set in prod) |
| `POSTGRES_DB` | `auth` |
