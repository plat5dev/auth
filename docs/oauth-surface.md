# OAuth surface

What Plat5 Auth exposes. It's an OAuth 2.0 issuer of signed JWT access tokens, built on OpenAuth. `/token` returns an access token and a refresh token, never an ID token, and there's no userinfo endpoint and no OpenID Connect discovery document (`/.well-known/openid-configuration` is a 404). Relying parties validate tokens as JWT (JWKS + `iss` + `aud` + `exp` + claims).

Tokens carry no name. A relying party like Plat5 owns a person's name.

## Endpoints (local compose)

| Surface | URL |
|---------|-----|
| Public issuer / UI | `http://localhost:5401` |
| JWKS | `http://localhost:5401/.well-known/jwks.json` |
| Authorization server metadata (RFC 8414) | `http://localhost:5401/.well-known/oauth-authorization-server` (OpenAuth) |
| Authorize | `http://localhost:5401/authorize` |
| Token | `http://localhost:5401/token` |

Listens on **5000**; the dev compose publishes host port **5401** (the Plat5 local port block). Internal health (not published): `INTERNAL_PORT` default `5001`.

## Token identity

| Concern | Value |
|---------|--------|
| User id type | ULID string |
| JWT subject properties | `{ "user_id": "<ulid>" }`, plus `"email"` when `AUTH_TOKEN_EMAIL=true` ([`env.md`](env.md)). Never a name |
| Claim path for user id | `properties.user_id`. Not `sub`: OpenAuth's `sub` is a hash of the token's properties, so it isn't stable |
| Signing | JWKS (`kid` in header); keys in OpenAuth storage |
| `iss` | Request origin via OpenAuth `getRelativeUrl` (`X-Forwarded-*`). Set `PUBLIC_ISSUER_URL` to pin `iss` (and the metadata) to the public origin relying parties use as `AUTH_ISSUER`. OpenAuth 0.4.3 has no `issuer:` config. |

Relying parties that map a dotted claim path to an opaque user id should use `properties.user_id` for tokens from Plat5 Auth (Plat5: `AUTH_SUBJECT_CLAIM=properties.user_id`).

## Clients and redirects

| Env | Purpose |
|-----|---------|
| `AUTH_ALLOWED_CLIENTS` | Comma-separated OAuth client IDs (default `plat5`) |
| `AUTH_ALLOWED_REDIRECT_URIS` | Redirect URI allowlist (required in prod compose; unset becomes deny-all) |
| `AUTH_ALLOWED_ORIGINS` | Browser CORS origins |

Operators set client IDs to match whatever audience / client their API gateway expects (e.g. Plat5 often uses audience `plat5`).

## Auth flows

- Password codes via email when `SMTP_*` is set (BYO SMTP); codes are logged only when `AUTH_DEV_MODE=true`
- OAuth 2.0 authorization code (OpenAuth)
- Default first UI after `/authorize` is password **login**. Add `prompt=create` to land on **register** instead (e.g. a "Create account" button). Allow-check and the authorization cookie are unchanged. Only `create` is honored; other `prompt` values are ignored. `none` / `login` / `consent` are not implemented. Do not send users to `/password/register` directly — that skips the client/redirect allowlist.

## Dev-only token mint

When `AUTH_DEV_MODE=true` (exact string), the issuer exposes:

```
POST /dev/token
Content-Type: application/json

{ "email": "e2e-a@plat5.test", "client_id": "plat5" }
```

| Field | Required | Notes |
|-------|----------|--------|
| `email` | yes | Lowercased; `getOrCreateUser(password, email)` → stable ULID |
| `client_id` | no | Default `plat5`; must be in `AUTH_ALLOWED_CLIENTS` |

Other fields, `name` among them, are ignored.

**Response `200`:**

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user_id": "<ulid>"
}
```

JWT shape matches normal access tokens (`properties.user_id`, plus `properties.email` when `AUTH_TOKEN_EMAIL=true`, `aud` = client_id, signed with the same JWKS keys). No name.

**Off by default.** Unless `AUTH_DEV_MODE` is exactly `true`, the route is not registered (falls through to OpenAuth → 404). `DEPLOYMENT_ENV` has no effect on it. The same flag also makes the issuer log login codes when SMTP is incomplete ([`env.md`](env.md#password-challenge-delivery)). The dev compose file sets `AUTH_DEV_MODE: "true"`; prod compose does not. When it is on, the issuer logs a warning at boot. It mints a valid token for any email, so never enable it on a reachable deployment.

Intended for local e2e / smoke tests so operators do not walk the browser + email-code flow.

## Database

Own Postgres. Default local DB name: `auth`. Schema `users` (accounts + `openauth_kv`). Not shared with other products.

## Network boundary

Own Docker network (`auth`). Do not join other products’ networks. Publish its port 5000; consumers reach JWKS over host or public URL.
