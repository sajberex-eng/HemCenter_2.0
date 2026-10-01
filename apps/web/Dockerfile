# Build context: repository root (see infra/docker-compose.yml)
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @hemcenter/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @hemcenter/shared build
# The API address is baked into the rewrite rules at build time.
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN pnpm --filter @hemcenter/web build

FROM node:22-slim
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
