#!/bin/bash
# Prepares a Claude Code on the web container so API tests, type checks and Playwright can run.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

# 1. PostgreSQL: start the service, create the role and the two databases (idempotent)
service postgresql start >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  su postgres -c "pg_isready -q" && break
  sleep 1
done
su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='hemcenter'\"" | grep -q 1 \
  || su postgres -c "psql -c \"CREATE ROLE hemcenter LOGIN SUPERUSER PASSWORD 'hemcenter'\""
for db in hemcenter hemcenter_test; do
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" | grep -q 1 \
    || su postgres -c "createdb -O hemcenter $db"
done

# 2. Dependencies (pnpm workspace + the separate e2e package)
pnpm install --no-frozen-lockfile
(cd e2e && pnpm install --ignore-workspace --no-frozen-lockfile)

# 3. Shared package must be compiled before the apps
pnpm --filter @hemcenter/shared build

# 4. Prisma client and migrations for the dev and test databases
(
  cd apps/api
  npx prisma generate
  DATABASE_URL=postgresql://hemcenter:hemcenter@localhost:5432/hemcenter npx prisma migrate deploy
  DATABASE_URL=postgresql://hemcenter:hemcenter@localhost:5432/hemcenter_test npx prisma migrate deploy
)

# 5. Dev environment file for running the API by hand (ignored by git); tests use vitest.config.ts
if [ ! -f apps/api/.env ]; then
  cat > apps/api/.env <<ENV
DATABASE_URL=postgresql://hemcenter:hemcenter@localhost:5432/hemcenter
JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
WEB_ORIGIN=http://localhost:3000
FILES_DIR=/tmp/hemcenter-dev-files
ENV
fi

# Playwright uses the pre-installed Chromium; do not download browsers
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers' >> "$CLAUDE_ENV_FILE"
  echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"
fi
