# Build context: repository root (see infra/docker-compose.yml)
FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @hemcenter/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @hemcenter/shared build \
 && pnpm --filter @hemcenter/api exec prisma generate \
 && pnpm --filter @hemcenter/api build

FROM node:22-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 4000
# Migrations are applied on every start; they are idempotent. The prisma binary is called directly
# so the container needs no network access (no corepack download) at start-up.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
