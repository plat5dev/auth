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
cp .env.template .env   # set secrets + AUTH_VERSION=v0.1.6
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Build the issuer image from this checkout instead of pulling:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.build.yml --env-file .env up --build -d
```

Required: `POSTGRES_PASSWORD`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `AUTH_ALLOWED_REDIRECT_URIS` (prod compose defaults to empty → deny all OAuth authorize). Optional: `PUBLIC_ISSUER_URL` (pins JWT `iss` / discovery behind a proxy), other `SMTP_*`, client allowlists, `AUTH_THEME_FILE` (OpenAuth Theme JSON; bind-mount the file, e.g. `./theme.json:/config/theme.json:ro` and `AUTH_THEME_FILE=/config/theme.json`).

**Mail is not bundled.** Set `SMTP_*` to any SMTP server (hosted provider, or a host-published local MTA). Host SMTP: `SMTP_HOST=host.docker.internal` and `extra_hosts: ["host.docker.internal:host-gateway"]` on the issuer.

Wire to Plat5 + TLS + SPA allowlists: [plat5 self-hosting](https://github.com/plat5dev/plat5/blob/master/docs/self-hosting.md).
