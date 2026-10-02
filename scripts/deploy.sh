#!/bin/bash
# Installs / updates HemCenter on an Ubuntu server with Docker. Run from the repository root as a user who may use sudo.
#   scripts/deploy.sh <domain> [admin-email]
#   e.g. scripts/deploy.sh 85-202-193-13.sslip.io it@example.kz
# Re-running updates the application; secrets in infra/.env are kept. Ports 80 and 443 must be reachable from the internet
# (needed for the HTTPS certificate). TEST DATA ONLY until the server is in Kazakhstan and the open points in docs/operations.md are closed.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${1:?usage: scripts/deploy.sh <domain> [admin-email]}"
EMAIL="${2:-admin@$DOMAIN}"
DC="sudo docker compose -f infra/docker-compose.yml --env-file infra/.env"

# Small servers (2 GB RAM): add swap so that building Next.js / NestJS and LibreOffice (PDF) do not get killed
if [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 3500 ] && [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  echo "== Low memory: creating 4 GB swap file /swapfile"
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "== Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo docker compose version >/dev/null

if [ ! -f infra/.env ]; then
  echo "== Creating infra/.env with fresh secrets"
  rand() { openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48; }
  cat > infra/.env <<ENV
DB_PASSWORD=$(rand)
JWT_SECRET=$(rand)
TOTP_KEY=$(rand)
DOMAIN=$DOMAIN
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:$EMAIL
APP_TIMEZONE=Asia/Almaty
MAX_UPLOAD_MB=25
BACKUP_KEEP_DAYS=30
BACKUP_HOST_DIR=./backups
ORG_NAME_RU=Центр гематологии
ORG_NAME_KK=Гематология орталығы
PDF_ENABLED=false
GOTENBERG_URL=
ENV
  chmod 600 infra/.env
fi
sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" infra/.env

if [ ! -f infra/backup.pass ]; then
  openssl rand -base64 32 | tr -d '\n' > infra/backup.pass
  chmod 600 infra/backup.pass
  echo "== Backup passphrase written to infra/backup.pass. COPY IT somewhere safe: without it backups cannot be opened."
fi
mkdir -p infra/backups

echo "== Building and starting (first build takes several minutes)"
# one image at a time: parallel builds need more memory than a 2 GB server has
export COMPOSE_PARALLEL_LIMIT=1
$DC build api web
$DC up -d db api web caddy

if ! grep -q '^VAPID_PUBLIC_KEY=.\+' infra/.env; then
  echo "== Generating Web Push keys"
  KEYS=$($DC run --rm --no-deps api node_modules/.bin/web-push generate-vapid-keys --json)
  PUB=$(echo "$KEYS" | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')
  PRIV=$(echo "$KEYS" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p')
  sed -i "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=$PUB|; s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=$PRIV|" infra/.env
  $DC up -d api
fi

echo "== Waiting for the API"
for _ in $(seq 1 60); do
  $DC exec -T api node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break
  sleep 3
done

echo "== First administrator (only when none exists)"
$DC exec -T api sh -c "cd /repo/apps/api && node_modules/.bin/tsx src/cli/create-admin.ts"

if ! sudo crontab -l 2>/dev/null | grep -q hemcenter-backup; then
  echo "== Daily backup at 02:30 (cron)"
  (sudo crontab -l 2>/dev/null; echo "30 2 * * * cd $PWD && $DC --profile tools run --rm backup >> $PWD/infra/backups/backup.log 2>&1 # hemcenter-backup") | sudo crontab -
fi

echo
echo "Done. Open https://$DOMAIN  (the certificate appears within a minute; if not: $DC logs caddy)"
echo "Sign in as the administrator with the one-time password printed above, then set 2FA when asked."
