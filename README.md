# Plat5 Auth

Optional **reference OIDC IdP** (OpenAuth + password codes + JWKS) for the Plat5 product family.

Self-contained: own compose network, own Postgres, own docs. Publish port `5000`; relying parties point at the host/public URL like any external IdP.

Image: `ghcr.io/plat5dev/auth` (multi-arch). Pin with `PLAT5_VERSION` (same family tag as runtime in 0.1.x) or any release tag from this repo.

## Layout

| Path | Role |
|------|------|
| `issuer/` | Bun OAuth2/OIDC service |
| `compose/` | Dev + prod stacks (issuer + Postgres) |
| `docs/` | OIDC surface, env, telemetry |

## Run (dev)

```bash
cd compose
docker compose up --build
```

- Auth UI / OIDC: `http://localhost:5000`
- JWKS: `http://localhost:5000/.well-known/jwks.json`
- Dev: no mail — signup codes appear in issuer logs
- Dev mint (non-prod): `POST /dev/token` with `{ "email": "…" }` → JWT + `user_id`

## Prod (images)

```bash
cd compose
cp .env.template .env   # set secrets + PLAT5_VERSION
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Local image build: add `-f docker-compose.prod.build.yml` and `--build`. See [`compose/README.md`](compose/README.md).

## Docs

| Doc | Contents |
|-----|----------|
| [`docs/oidc-surface.md`](docs/oidc-surface.md) | Endpoints, subjects, clients |
| [`docs/env.md`](docs/env.md) | Environment variables |
| [`docs/telemetry.md`](docs/telemetry.md) | Logs, traces, metrics |
| [`issuer/README.md`](issuer/README.md) | Service dev details |

## Wire to Plat5

Plat5 is IdP-agnostic. Point gateway env at this issuer:

| Plat5 env | Typical value |
|-----------|----------------|
| `AUTH_ISSUER` | Public issuer URL (e.g. `https://auth.example.com`) |
| `AUTH_JWKS_URI` | URL the gateway container can fetch JWKS |
| `AUTH_USER_ID_CLAIM` | `properties.user_id` |
| `AUTH_ALLOWED_AUDIENCES` | e.g. `plat5` |

Consumer DX: [`plat5dev/cli`](https://github.com/plat5dev/cli) (`plat5 start --auth` pulls the published image). Self-host: [plat5dev/plat5 self-hosting](https://github.com/plat5dev/plat5/blob/master/docs/self-hosting.md).

## License

MIT — see [LICENSE](LICENSE).
