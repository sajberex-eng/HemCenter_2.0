#!/usr/bin/env bash
# Restores a backup made by backup.sh.
#
#   restore.sh /path/to/hemcenter-YYYYMMDD-HHMMSS.tar.gpg
#
#   DATABASE_URL            the database to restore INTO
#   FILES_DIR               the directory to restore the files INTO
#   BACKUP_PASSPHRASE_FILE  the passphrase file used for the backup
#   CONFIRM_OVERWRITE=yes   required when the database already has tables or the files directory is not empty
#
# The archive is decrypted and its checksums are verified BEFORE anything is changed.
set -euo pipefail

archive="${1:?usage: restore.sh <backup.tar.gpg>}"
: "${DATABASE_URL:?set DATABASE_URL}"
: "${FILES_DIR:?set FILES_DIR}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"
[ -f "$archive" ] || { echo "no such file: $archive" >&2; exit 2; }

if [ -f "$archive.sha256" ]; then
  (cd "$(dirname "$archive")" && sha256sum --check --status "$(basename "$archive").sha256") || { echo "the archive does not match its checksum: damaged or tampered with" >&2; exit 3; }
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077

echo "[restore] decrypting"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt --output "$work/bundle.tar" "$archive" \
  || { echo "cannot decrypt: wrong passphrase or damaged archive" >&2; exit 3; }
tar -C "$work" -xf "$work/bundle.tar"
(cd "$work" && sha256sum --check --status SHA256SUMS) || { echo "the contents do not match their checksums" >&2; exit 3; }

tables="$(psql "$DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$tables" != "0" ] && [ "${CONFIRM_OVERWRITE:-}" != "yes" ]; then
  echo "the database is not empty ($tables tables). Set CONFIRM_OVERWRITE=yes to replace its contents." >&2
  exit 4
fi
if [ -d "$FILES_DIR" ] && [ -n "$(ls -A "$FILES_DIR" 2>/dev/null)" ] && [ "${CONFIRM_OVERWRITE:-}" != "yes" ]; then
  echo "the files directory is not empty. Set CONFIRM_OVERWRITE=yes to replace its contents." >&2
  exit 4
fi

echo "[restore] database"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname "$DATABASE_URL" "$work/db.dump"
echo "[restore] files"
mkdir -p "$FILES_DIR"
tar -C "$FILES_DIR" -xf "$work/files.tar"
echo "[restore] done"
