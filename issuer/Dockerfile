# ======================================================================
# Local Stage for development
FROM oven/bun:1 AS local

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install

COPY src ./src
COPY public ./public

ENV PORT=5000
EXPOSE 5000

CMD ["bun", "dev"]

# ======================================================================
# Prod Stage for production
# Note: Unlike compiled languages (Rust, Go), Bun runs TypeScript directly
# so there's no build step needed. A separate builder stage would only be
# useful for pruning devDependencies, but ours are just @types/* packages
# with negligible size and no runtime impact.
FROM oven/bun:1-slim AS prod

ARG VERSION=dev
ARG REVISION=
ARG SOURCE=https://github.com/plat5dev/auth

LABEL org.opencontainers.image.title="auth" \
      org.opencontainers.image.description="Plat5 Auth issuer" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

RUN groupadd -r app && useradd -r -g app app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY public ./public

USER app

ENV PORT=5000
ENV NODE_ENV=production
EXPOSE 5000

CMD ["bun", "start"]
