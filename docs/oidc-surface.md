# OIDC surface

What Plat5 Auth exposes. Relying parties validate tokens via standard OIDC/JWT (JWKS + `iss` + claims).

## Endpoints (local compose)

| Surface | URL |
|---------|-----|
| Public issuer / UI | `http://localhost:5000` |
| JWKS | `http://localhost:5000/.well-known/jwks.json` |
| OIDC discovery | `http://localhost:5000/.well-known/oauth-authorization-server` (OpenAuth) |

Published host port: **5000**. Internal health (not published): `INTERNAL_PORT` default `5001`.

## Token identity

| Concern | Value |
|---------|--------|
| User id type | ULID string |
| JWT subject properties | `{ "user_id": "<ulid>" }` |
| Claim path for user id | `properties.user_id` |
| Signing | JWKS (`kid` in header); keys in OpenAuth storage |

Relying parties that map a dotted claim path to an opaque user id should use `properties.user_id` for tokens from Plat5 Auth.

## Clients and redirects

| Env | Purpose |
|-----|---------|
| `AUTH_ALLOWED_CLIENTS` | Comma-separated OAuth client IDs (default `plat5`) |
| `AUTH_ALLOWED_REDIRECT_URIS` | Redirect URI allowlist |
| `AUTH_ALLOWED_ORIGINS` | Browser CORS origins |

Operators set client IDs to match whatever audience / client their API gateway expects (e.g. Plat5 often uses audience `plat5`).

## Auth flows

- Password codes via email when `SMTP_*` is set (BYO SMTP); otherwise codes logged in dev
- OAuth2/OIDC authorization code (OpenAuth)

## Dev-only token mint

When `DEPLOYMENT_ENV` is **not** `prod`, the issuer exposes:

```
POST /dev/token
Content-Type: application/json

{ "email": "e2e-a@plat5.test", "client_id": "plat5" }
```

| Field | Required | Notes |
|-------|----------|--------|
| `email` | yes | Lowercased; `getOrCreateUser(password, email)` → stable ULID |
| `client_id` | no | Default `plat5`; must be in `AUTH_ALLOWED_CLIENTS` |

**Response `200`:**

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user_id": "<ulid>"
}
```

JWT shape matches normal access tokens (`properties.user_id`, `aud` = client_id, signed with the same JWKS keys).

**Not available in prod** (`DEPLOYMENT_ENV=prod`): route is not registered (falls through to OpenAuth → 404).

Intended for local e2e / smoke tests so operators do not walk the browser + email-code flow.

## Database

Own Postgres. Default local DB name: `auth`. Schema `users` (accounts + `openauth_kv`). Not shared with other products.

## Network boundary

Own Docker network (`auth`). Do not join other products’ networks. Publish port 5000; consumers reach JWKS over host or public URL.
