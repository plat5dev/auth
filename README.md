# Plat5 Auth

Optional **reference OAuth 2.0 issuer of signed JWT access tokens**, built on OpenAuth (password codes + JWKS), for the Plat5 product family. Its tokens carry no name: a relying party like Plat5 owns names.

Self-contained: own compose network, own Postgres, own docs. Listens on `5000` (dev compose publishes it on host `5401`); relying parties point at the host/public URL like any external IdP.

Image: `ghcr.io/plat5dev/auth` (multi-arch). Tags are cut from **this** repo only: push a `v*` git tag → release workflow builds multi-arch and pushes. Pin with **`AUTH_VERSION`** (compose/CLI), independent of Plat5 runtime tags.

## Layout

| Path | Role |
|------|------|
| `issuer/` | Bun OAuth 2.0 issuer |
| `compose/` | Dev + prod stacks (issuer + Postgres) |
| `docs/` | OAuth surface, env, telemetry |

## Run (dev)

```bash
cd compose
docker compose up --build
```

- Auth UI / OAuth 2.0: `http://localhost:5401`
- JWKS: `http://localhost:5401/.well-known/jwks.json`
- Dev: no mail — signup codes appear in issuer logs (needs `AUTH_DEV_MODE=true`, which dev compose sets)
- Dev login: `AUTH_DEV_USERS=email:password,…` seeds password logins at boot (dev compose: `dev@example.com` / `password`). Only when `AUTH_DEV_MODE=true`
- Dev mint: `POST /dev/token` with `{ "email": "…" }` → JWT + `user_id`. Only when `AUTH_DEV_MODE=true` (dev compose sets it; prod compose does not)

## Prod (images)

```bash
cd compose
cp .env.template .env   # set secrets + AUTH_VERSION
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Local image build: add `-f docker-compose.prod.build.yml` and `--build`. See [`compose/README.md`](compose/README.md).

## Docs

| Doc | Contents |
|-----|----------|
| [`docs/oauth-surface.md`](docs/oauth-surface.md) | Endpoints, subjects, clients |
| [`docs/env.md`](docs/env.md) | Environment variables |
| [`docs/telemetry.md`](docs/telemetry.md) | Logs, traces, metrics |
| [`issuer/README.md`](issuer/README.md) | Service dev details |

## Wire to Plat5

Plat5 accepts any issuer of signed JWT access tokens. Point gateway env at this issuer:

| Plat5 env | Typical value |
|-----------|----------------|
| `AUTH_ISSUER` | Public issuer URL (e.g. `https://auth.example.com`) |
| `AUTH_JWKS_URI` | URL the gateway container can fetch JWKS |
| `AUTH_SUBJECT_CLAIM` | `properties.user_id` (OpenAuth's own `sub` is a hash of the token's properties, so it isn't stable) |
| `AUTH_ALLOWED_AUDIENCES` | e.g. `plat5` |

Local dev: [`plat5dev/cli`](https://github.com/plat5dev/cli) runs Plat5 Auth as its `auth` module, on unless `plat5.dev.yml` turns it off, in dev mode on `5401`. Self-host: [plat5dev/plat5 deploy](https://github.com/plat5dev/plat5/blob/master/docs/guides/deploy.md).

## License

MIT — see [LICENSE](LICENSE).
