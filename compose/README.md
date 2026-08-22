# Plat5 Auth compose

Self-contained Auth stack. Own network. Issuer + Postgres only.

## Quick start (dev)

No mail. Password challenge codes are logged by the issuer.

```bash
cd compose
docker compose up --build
```

| URL | Service |
|-----|---------|
| `http://localhost:5000` | Issuer (OIDC / Auth UI) |
| `http://localhost:5000/.well-known/jwks.json` | JWKS |

Postgres DB `auth`. Relying parties reach JWKS via the published host URL. Do not join this network from other products.

## Prod

Pull the published image (`ghcr.io/plat5dev/auth:${AUTH_VERSION}`; tags from this repo’s `v*` releases):

```bash
cp .env.template .env   # set secrets + AUTH_VERSION=v0.1.2
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Build the issuer image from this checkout instead of pulling:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.build.yml --env-file .env up --build -d
```

Required: `POSTGRES_PASSWORD`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`. Optional: `PUBLIC_ISSUER_URL`, other `SMTP_*`, client allowlists.

**Mail is not bundled.** Set `SMTP_*` to any SMTP server (hosted provider, or a host-published local MTA). Host SMTP: `SMTP_HOST=host.docker.internal` and `extra_hosts: ["host.docker.internal:host-gateway"]` on the issuer.

Wire to Plat5 + TLS + SPA allowlists: [plat5 self-hosting](https://github.com/plat5dev/plat5/blob/master/docs/self-hosting.md).
