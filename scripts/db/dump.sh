#!/usr/bin/env bash
# Nightly logical dump of the Rumi database. No secrets in this file: the connection comes from the environment.
#
#   SUPABASE_DB_URL  Postgres connection string of the database to dump (Dashboard > Connect > Session pooler).
#                    READ-ONLY use: pg_dump never writes. If unset, the LOCAL stack (npx supabase start) is dumped.
#   DUMP_DIR         where files go (default ../rumi-db-backups, outside the repo)
#   DUMP_KEEP        how many dumps to keep (default 14)
#
# Produces three files per run, then a checksum list:
#   schema-<UTC>.sql.gz  public schema (tables, policies, functions)
#   data-<UTC>.sql.gz    data of public AND auth (users are the identity: without auth.users the data has no owners)
#   roles-<UTC>.sql.gz   cluster roles
# Copy the files to PRIVATE storage afterwards (they contain user content). Restore drill: scripts/db/restore-drill.sh.
# Schedule: a GitHub Actions cron or any host cron: `17 4 * * * SUPABASE_DB_URL=... scripts/db/dump.sh`.
set -euo pipefail
cd "$(dirname "$0")/../.."
dir="${DUMP_DIR:-../rumi-db-backups}"; keep="${DUMP_KEEP:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$dir"
if [ -n "${SUPABASE_DB_URL:-}" ]; then target=("--remote=$SUPABASE_DB_URL"); else target=(); fi

dump() { # dump <name> <supabase db dump args...>
  local name="$1"; shift
  npx supabase db dump "${target[@]}" "$@" -f "$dir/$name-$stamp.sql" >/dev/null
  [ -s "$dir/$name-$stamp.sql" ] || { echo "dump $name is empty" >&2; exit 1; }
  gzip -f "$dir/$name-$stamp.sql"
}
dump schema -s public
dump data --data-only --use-copy -s public,auth
dump roles --role-only
( cd "$dir" && sha256sum ./*-"$stamp".sql.gz > "sha256-$stamp.txt" )

# keep the newest $keep runs
ls -1 "$dir"/schema-*.sql.gz 2>/dev/null | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  s="$(basename "$old" | sed -E 's/schema-(.*)\.sql\.gz/\1/')"
  rm -f "$dir"/schema-"$s".sql.gz "$dir"/data-"$s".sql.gz "$dir"/roles-"$s".sql.gz "$dir"/sha256-"$s".txt
done
echo "dump ok: $dir/*-$stamp.sql.gz"
