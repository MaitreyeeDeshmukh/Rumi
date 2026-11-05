#!/usr/bin/env bash
# Run a SQL file against the LOCAL Supabase stack (never remote): scripts/db/run-sql.sh <file.sql>
# The container is supabase_db_<project_id from supabase/config.toml>; set RUMI_DB_CONTAINER to use another one.
# `supabase db query -f` accepts one statement only, so multi-statement test files go through
# psql inside the local database container. Stops at the first error, exits non-zero.
set -euo pipefail
cd "$(dirname "$0")/../.."
file="${1:?usage: run-sql.sh <file.sql>}"
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="${RUMI_DB_CONTAINER:-supabase_db_${project}}" # project_id from supabase/config.toml; RUMI_DB_CONTAINER overrides
docker ps --format '{{.Names}}' | grep -qx "$container" || { echo "local stack not running ($container): run 'npx supabase start'" >&2; exit 2; }
docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -P pager=off < "$file"
