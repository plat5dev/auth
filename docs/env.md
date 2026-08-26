# Environment variables

## issuer

| Variable | Purpose | Default / notes |
|----------|---------|-----------------|
| `DATABASE_URL` | Postgres for users + OpenAuth storage | Required |
| `INTERNAL_PORT` | Internal health + `/metrics` (not public OIDC) | `5001` |
| `PUBLIC_ISSUER_URL` | Pins JWT `iss` and OIDC discovery to this origin (OpenAuth 0.4.3 has no `issuer:` option; the issuer injects `X-Forwarded-*` so `getRelativeUrl` uses it). Also used by `POST /dev/token`. Set this when the request origin is the container hostname, otherwise `iss` is the container origin and relying-party `AUTH_ISSUER` checks 401. | Optional; trailing slash stripped |
| `INVITE_REDEEM_URL` | After password success, if an invite token was present on `/authorize` (query, then cookie through the password UI), append `invite` to the OAuth redirect. When this URL's origin+path **equals** that redirect, Auth uses it and copies `code`/`state` (so token exchange still matches `redirect_uri`). Invite emails should use this URL as `redirect_uri` (and list it in `AUTH_ALLOWED_REDIRECT_URIS`). | Optional |
| `IDENTITY_INVITE_REDEEM_URL` | Optional **public** identity/gateway URL for `POST` `{ token, user_id }` after password success (typically `/internal/invites/redeem`). Auth must **not** join plat5's Docker network — use a host-published or public URL. Unset = browser/console redeems via user-scope `POST /api/invites/redeem`. | Optional |
| `IDENTITY_INTERNAL_TOKEN` | Sent as `X-Plat5-Internal-Token` when calling `IDENTITY_INVITE_REDEEM_URL`. Same value as identity `INTERNAL_AUTH_TOKEN`. | Optional |
| `AUTH_ALLOWED_CLIENTS` | OAuth client IDs (comma-separated) | `plat5` |
| `AUTH_ALLOWED_REDIRECT_URIS` | Redirect URI allowlist | Code default: Postman + localhost. Prod compose interpolates unset to empty string → empty allowlist → deny all `/authorize`. Required in production. |
| `AUTH_ALLOWED_ORIGINS` | Browser CORS origins | See code defaults |
| `AUTH_DISPLAY_NAME` | Login UI title and password-challenge email copy | `Plat5` |
| `AUTH_LOGO_URL` | Login UI logo (light and dark) | `/static/logo.jpg` |
| `AUTH_FAVICON_URL` | Login UI favicon | `/static/p5.jpg` |
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

## Org invites

Auth stays IdP-shaped: no org/member store, no second mailer (password-challenge SMTP is unchanged).

Invitee flow:

1. Console creates an invite on identity; identity returns a token (and optional Auth URL).
2. Vendors copy `{app_origin}/login?invite=` (not the raw Auth URL). The app's PKCE beginLogin forwards `invite=` onto this issuer's `/authorize`.
3. Auth stores the token in an HttpOnly cookie so it survives password login **and** register.
4. After success, Auth appends `invite` to the OAuth `Location`. If `IDENTITY_INVITE_REDEEM_URL` is set, Auth also POSTs `{ token, user_id }` to that public URL.
5. Console (or identity, if Auth called it) inserts an **active** member. No pending rows.
