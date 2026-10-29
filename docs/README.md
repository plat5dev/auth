# Plat5 Auth docs

Plat5 Auth is an optional reference OAuth 2.0 issuer of signed JWT access tokens, built on OpenAuth. Its tokens carry no name: a relying party like Plat5 owns names.

| Document | Purpose |
|----------|---------|
| [`oauth-surface.md`](oauth-surface.md) | What this OAuth 2.0 issuer exposes (authorization server metadata, JWKS, subjects, clients) |
| [`telemetry.md`](telemetry.md) | Logs, traces, metrics (stdout, scrape, OTLP) |
| [`env.md`](env.md) | Environment variables |

Service details: [`../issuer/README.md`](../issuer/README.md).
