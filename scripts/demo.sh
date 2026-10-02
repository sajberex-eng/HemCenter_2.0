#!/bin/bash
# Starts HemCenter locally with demo data (TEST DATA ONLY: 2FA for management is switched off).
# Needs: Node 22, pnpm 10, a running PostgreSQL where DATABASE_URL (default below) can create tables.
#   scripts/demo.sh            start API (4000) and web (3000)
#   scripts/demo.sh stop       stop both
# Afterwards open https://<tunnel> on the phone, see docs/demo-on-phone.md
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
RUN="$ROOT/.demo"; mkdir -p "$RUN"

if [ "${1:-}" = "stop" ]; then
  for f in api web; do [ -f "$RUN/$f.pid" ] && kill "$(cat "$RUN/$f.pid")" 2>/dev/null || true; rm -f "$RUN/$f.pid"; done
  echo "Stopped."; exit 0
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://hemcenter:hemcenter@localhost:5432/hemcenter_demo}"
export JWT_SECRET="${JWT_SECRET:-demo-only-secret-demo-only-secret-demo-only-1234}"
export FILES_DIR="${FILES_DIR:-$RUN/files}"
export REQUIRE_ADMIN_TOTP=false DISABLE_THROTTLE=true
export APP_TIMEZONE="${APP_TIMEZONE:-Asia/Almaty}"
unset WEB_ORIGIN NODE_ENV

if [ ! -f "$RUN/vapid.env" ]; then
  (cd apps/api && node -e "const k=require('web-push').generateVAPIDKeys();console.log('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey+'\nVAPID_SUBJECT=mailto:demo@example.com')") > "$RUN/vapid.env"
fi
set -a; . "$RUN/vapid.env"; set +a

pnpm install --no-frozen-lockfile
pnpm --filter @hemcenter/shared build
(cd apps/api && npx prisma generate >/dev/null && npx prisma migrate deploy && pnpm build)
(cd apps/web && pnpm build)

(cd apps/api && ADMIN_LOGIN=demo-admin ADMIN_PASSWORD=Demo-pass-123 ADMIN_MUST_CHANGE=false npx tsx src/cli/create-admin.ts)
(cd apps/api && nohup node dist/main.js > "$RUN/api.log" 2>&1 & echo $! > "$RUN/api.pid")
for _ in $(seq 1 60); do curl -fs localhost:4000/api/health >/dev/null 2>&1 && break; sleep 1; done
(cd apps/api && npx tsx scripts/demo-seed.ts)
(cd apps/web && API_URL=http://localhost:4000 nohup pnpm start > "$RUN/web.log" 2>&1 & echo $! > "$RUN/web.pid")
sleep 4
echo
echo "Ready: http://localhost:3000   (logins: demo-admin, director, manager, secretary, anna, boris; password Demo-pass-123)"
echo "For the phone run in another terminal:  cloudflared tunnel --url http://localhost:3000"
