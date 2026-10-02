# Shared helpers for backup.sh, restore.sh and verify-restore.sh.

# "table<TAB>rows" for every table of the database, sorted by name.
table_counts() {
  local url="$1" t
  psql "$url" -Atc "select tablename from pg_tables where schemaname='public' order by tablename" | while read -r t; do
    printf '%s\t%s\n' "$t" "$(psql "$url" -Atc "select count(*) from public.\"$t\"")"
  done
}

# "__files<TAB>count" and "__bytes<TAB>total size" of a directory tree.
file_stats() {
  local dir="$1"
  printf '__files\t%s\n' "$(find "$dir" -type f | wc -l | tr -d ' ')"
  printf '__bytes\t%s\n' "$(find "$dir" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')"
}
