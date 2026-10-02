#!/usr/bin/env bash
# Self-test of the backup tools against a real database (it only reads it): backup, restore drill, damaged and wrong-key
# archives, refusal to overwrite, retention. Needs DATABASE_URL, FILES_DIR and the right to create a scratch database.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${DATABASE_URL:?set DATABASE_URL}"
: "${FILES_DIR:?set FILES_DIR}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export BACKUP_DIR="$tmp/backups" BACKUP_PASSPHRASE_FILE="$tmp/pass"
printf 'correct horse battery staple' > "$tmp/pass"
printf 'some other passphrase' > "$tmp/wrong"
fail=0
check() { # name, expected exit, command...
  local name="$1" want="$2"; shift 2
  local out code
  out="$("$@" 2>&1)"; code=$?
  if [ "$code" = "$want" ]; then echo "ok   - $name"; else echo "FAIL - $name (exit $code, wanted $want)"; echo "$out" | tail -5 | sed 's/^/       /'; fail=1; fi
}

check "backup runs" 0 "$here/backup.sh"
archive="$(ls -1 "$BACKUP_DIR"/hemcenter-*.tar.gpg | head -1)"
check "the archive has a checksum file" 0 test -s "$archive.sha256"
check "the archive is not readable without the key" 2 sh -c "gpg --batch --quiet --pinentry-mode loopback --passphrase-file '$tmp/wrong' --decrypt '$archive' >/dev/null 2>&1; exit \$((\$?>0?2:0))"
check "no plain-text database dump is left in the backup folder" 0 sh -c "! ls '$BACKUP_DIR' | grep -qE '\\.(dump|sql|tar)\$'"

out="$("$here/verify-restore.sh" "$archive" 2>&1)"; code=$?
if [ "$code" = 0 ] && echo "$out" | grep -q "RESTORE CHECK PASSED"; then echo "ok   - restore drill: $(echo "$out" | tail -1)"; else echo "FAIL - restore drill"; echo "$out" | tail -8 | sed 's/^/       /'; fail=1; fi

# a damaged copy is refused, with and without the checksum file
cp "$archive" "$tmp/bad.tar.gpg"; cp "$archive.sha256" "$tmp/bad.tar.gpg.sha256"
printf '\xff' | dd of="$tmp/bad.tar.gpg" bs=1 seek=4096 conv=notrunc status=none
export CONFIRM_OVERWRITE=yes
check "a damaged archive is refused (checksum)" 3 env DATABASE_URL="$DATABASE_URL" FILES_DIR="$tmp/never" "$here/restore.sh" "$tmp/bad.tar.gpg"
rm "$tmp/bad.tar.gpg.sha256"
check "a damaged archive is refused (encryption integrity)" 3 env DATABASE_URL="$DATABASE_URL" FILES_DIR="$tmp/never" "$here/restore.sh" "$tmp/bad.tar.gpg"
check "a wrong passphrase is refused" 3 env BACKUP_PASSPHRASE_FILE="$tmp/wrong" DATABASE_URL="$DATABASE_URL" FILES_DIR="$tmp/never" "$here/restore.sh" "$archive"
unset CONFIRM_OVERWRITE
check "restoring over a database with data needs a confirmation" 4 env DATABASE_URL="$DATABASE_URL" FILES_DIR="$tmp/never" "$here/restore.sh" "$archive"
check "nothing was written by the refused attempts" 1 test -e "$tmp/never"

# retention: old archives go (but the 7 newest stay), fresh ones never go
rm -rf "$BACKUP_DIR"; mkdir -p "$BACKUP_DIR"
for i in $(seq 1 12); do f="$BACKUP_DIR/hemcenter-2020010$((i % 9 + 1))-0000$i.tar.gpg"; : > "$f"; : > "$f.sha256"; touch -d "40 days ago" "$f" "$f.sha256"; done
"$here/backup.sh" >/dev/null 2>&1
check "old archives are pruned down to the 7 newest" 0 test "$(ls -1 "$BACKUP_DIR"/hemcenter-*.tar.gpg | wc -l)" = 7
check "the new archive survived the pruning" 0 sh -c "ls -1t '$BACKUP_DIR'/hemcenter-*.tar.gpg | head -1 | xargs test -s"
rm -rf "$BACKUP_DIR"; mkdir -p "$BACKUP_DIR"
for i in $(seq 1 12); do : > "$BACKUP_DIR/hemcenter-2026010$((i % 9 + 1))-0000$i.tar.gpg"; done
"$here/backup.sh" >/dev/null 2>&1
check "fresh archives are never pruned" 0 test "$(ls -1 "$BACKUP_DIR"/hemcenter-*.tar.gpg | wc -l)" = 13

[ "$fail" = 0 ] && echo "ALL BACKUP CHECKS PASSED" || { echo "SOME BACKUP CHECKS FAILED"; exit 1; }
