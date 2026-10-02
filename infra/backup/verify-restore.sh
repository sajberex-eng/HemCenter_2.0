#!/usr/bin/env bash
# Restore drill: opens a backup in a scratch database and a scratch directory and checks that what comes out is what went in
# (the row count of every table, the number and size of the files). Nothing of the live system is touched. Run it after
# changes to the backup set-up and from time to time (once a month), and keep the result.
#
#   verify-restore.sh /path/to/hemcenter-YYYYMMDD-HHMMSS.tar.gpg
#
#   ADMIN_DATABASE_URL      a connection with the right to create a database (default: DATABASE_URL pointing at "postgres")
#   BACKUP_PASSPHRASE_FILE  the passphrase file
set -euo pipefail
source "$(dirname "$0")/lib.sh"

archive="${1:?usage: verify-restore.sh <backup.tar.gpg>}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"
admin="${ADMIN_DATABASE_URL:-}"
if [ -z "$admin" ]; then
  : "${DATABASE_URL:?set ADMIN_DATABASE_URL or DATABASE_URL}"
  admin="$(printf '%s' "$DATABASE_URL" | sed -E 's#/[^/?]+(\?|$)#/postgres\1#')"
fi

scratch="hemcenter_restore_check_$$"
dir="$(mktemp -d)"
work="$(mktemp -d)"
cleanup() { psql "$admin" -qAtc "drop database if exists $scratch" >/dev/null 2>&1 || true; rm -rf "$dir" "$work"; }
trap cleanup EXIT

psql "$admin" -qAtc "create database $scratch" >/dev/null
url="$(printf '%s' "$admin" | sed -E "s#/postgres(\?|\$)#/$scratch\1#")"

CONFIRM_OVERWRITE=yes DATABASE_URL="$url" FILES_DIR="$dir" "$(dirname "$0")/restore.sh" "$archive" >/dev/null

# what the backup said it contained
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt --output "$work/bundle.tar" "$archive"
tar -C "$work" -xf "$work/bundle.tar" counts.txt

{ table_counts "$url"; file_stats "$dir"; } > "$work/restored.txt"
if diff -u "$work/counts.txt" "$work/restored.txt"; then
  echo "RESTORE CHECK PASSED: $(grep -vc '^__' "$work/counts.txt") tables, $(awk -F'\t' '$1=="__files"{print $2}' "$work/counts.txt") files, $(awk -F'\t' '$1!~/^__/{s+=$2} END{print s}' "$work/counts.txt") rows"
else
  echo "RESTORE CHECK FAILED: the restored data differs from what was backed up" >&2
  exit 1
fi
