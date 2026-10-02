#!/usr/bin/env bash
# Encrypted backup of the database and the attachment files.
#
#   DATABASE_URL            postgresql://user:password@host:5432/hemcenter
#   FILES_DIR               directory with attachments, templates and scans
#   BACKUP_DIR              where the encrypted archives are put (keep a second copy on another server in Kazakhstan)
#   BACKUP_PASSPHRASE_FILE  file with the passphrase (chmod 600). Lose it and the backups cannot be opened.
#   BACKUP_KEEP_DAYS        delete archives older than this (default 30), but always keep the 7 newest
#
# Result: $BACKUP_DIR/hemcenter-YYYYMMDD-HHMMSS.tar.gpg and a .sha256 next to it.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

: "${DATABASE_URL:?set DATABASE_URL}"
: "${FILES_DIR:?set FILES_DIR}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

[ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "passphrase file is missing or empty: $BACKUP_PASSPHRASE_FILE" >&2; exit 2; }
[ -d "$FILES_DIR" ] || { echo "no such directory: $FILES_DIR" >&2; exit 2; }
mkdir -p "$BACKUP_DIR"
umask 077

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/hemcenter-$stamp.tar.gpg"

echo "[backup] database"
# one snapshot for both the dump and the row counts: a transaction that sees the database as it was at one moment
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" > "$work/db.dump"
table_counts "$DATABASE_URL" > "$work/counts.txt"
echo "[backup] files"
tar -C "$FILES_DIR" -cf "$work/files.tar" .
file_stats "$FILES_DIR" >> "$work/counts.txt"
(cd "$work" && sha256sum db.dump files.tar counts.txt > SHA256SUMS && tar -cf bundle.tar db.dump files.tar counts.txt SHA256SUMS)

echo "[backup] encrypting"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --output "$out.part" "$work/bundle.tar"
mv "$out.part" "$out"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")

# retention: older than KEEP_DAYS go, but never the 7 newest
mapfile -t all < <(ls -1t "$BACKUP_DIR"/hemcenter-*.tar.gpg 2>/dev/null || true)
if [ "${#all[@]}" -gt 7 ]; then
  for f in "${all[@]:7}"; do
    if [ -n "$(find "$f" -mtime +"$KEEP_DAYS" -print 2>/dev/null)" ]; then rm -f "$f" "$f.sha256"; fi
  done
fi

echo "[backup] done: $out ($(du -h "$out" | cut -f1))"
