#!/usr/bin/env bash
# 100k-user scale check on the LOCAL stack. Seeds synthetic data inside one transaction, runs the checks,
# then ROLLS BACK, so the local database is unchanged. Usage: scripts/db/scale-check.sh [users]  (default 100000)
set -euo pipefail
cd "$(dirname "$0")/../.."
users="${1:-100000}"
[[ "$users" =~ ^[0-9]+$ ]] && [ "$users" -ge 6000 ] && [ "$users" -le 1000000 ] || { echo "users must be an integer between 6000 and 1000000" >&2; exit 2; }
unset SUPABASE_DB_URL
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
{
  echo "begin;"
  echo "set local rumi.seed_users = '$users';"
  echo "set local statement_timeout = 0;"
  cat scripts/db/seed-synthetic.sql
  cat supabase/tests/scale_100k.sql
  echo "rollback;"
} > "$tmp"
bash scripts/db/run-sql.sh "$tmp"
