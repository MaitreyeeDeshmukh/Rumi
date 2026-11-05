#!/usr/bin/env bash
# 100k-user scale check on the LOCAL stack. Seeds synthetic data inside one transaction, runs the checks,
# then ROLLS BACK, so the local database is unchanged. Usage: scripts/db/scale-check.sh [users]  (default 100000)
set -euo pipefail
cd "$(dirname "$0")/../.."
users="${1:-100000}"
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
