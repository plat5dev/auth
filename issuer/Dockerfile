# ======================================================================
# Local Stage for development
FROM oven/bun:1.4 AS local

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
# Bun runs TypeScript directly, so no build stage is needed; `--production`
# excludes devDependencies (types, typescript) from the runtime image.
FROM oven/bun:1.4-slim AS prod

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

# The release this build reports as service.version; dev without one.
RUN bun -e 'const v = process.env.VERSION || "dev"; await Bun.write("src/version.ts", `export const version: string = ${JSON.stringify(v)};\n`)'

USER app

ENV PORT=5000
ENV NODE_ENV=production
EXPOSE 5000

CMD ["bun", "src/issuer.ts"]
