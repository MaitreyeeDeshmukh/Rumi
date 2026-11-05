#!/usr/bin/env bash
# Concurrency test for ops_take_ai_quota on the LOCAL stack: 24 parallel sessions race for a quota of 7 on one
# bucket. Callers 1-12 also take a second bucket (limit 10), callers 13-24 only the first.
# Exactly 7 calls may succeed, the first bucket must count exactly 7, and the second bucket must count exactly
# the successful callers among 1-12 (a refused call must not leave a count behind).
# Each session holds its transaction open 1 s after a successful take, to widen the race window.
# Usage: scripts/db/quota-concurrency.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="supabase_db_${project}"
sql() { docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
bucket="conc:$$"; shared="conc-shared:$$"
cleanup() { echo "delete from public.ops_ai_usage_daily where bucket in ('$bucket', '$shared')" | sql >/dev/null; }
trap cleanup EXIT
dir="$(mktemp -d)"
for i in $(seq 1 24); do
  if [ "$i" -le 12 ]; then call="array['$bucket','$shared'], array[7,10]"; else call="array['$bucket'], array[7]"; fi
  # each session keeps its transaction open for 1 s after a successful take, so without the advisory lock
  # many sessions would read the same count and all succeed (the race this test exists to catch)
  ( printf '%s
' "begin;" "set local role service_role;" "select public.ops_take_ai_quota($call) as ok \gset" "\if :ok" "select pg_sleep(1);" "\endif" "commit;" "\echo :ok" | sql > "$dir/$i.out" 2>&1 ) &
done
wait
trues=$(cat "$dir"/*.out | grep -c '^t$'); falses=$(cat "$dir"/*.out | grep -c '^f$')
errs=$(cat "$dir"/*.out | grep -vcE '^(t|f|SET)?$')
first12=$(for i in $(seq 1 12); do cat "$dir/$i.out"; done | grep -c '^t$')
used=$(echo "select coalesce(sum(calls),0) from public.ops_ai_usage_daily where bucket='$bucket' and day=(now() at time zone 'utc')::date" | sql)
used2=$(echo "select coalesce(sum(calls),0) from public.ops_ai_usage_daily where bucket='$shared' and day=(now() at time zone 'utc')::date" | sql)
echo "true=$trues false=$falses errors=$errs counted(bucket)=$used counted(shared)=$used2 true-among-first-12=$first12"
if [ "$errs" = 0 ] && [ "$trues" = 7 ] && [ "$used" = 7 ] && [ "$used2" = "$first12" ] && [ "$((trues + falses))" = 24 ]; then
  echo "QUOTA CONCURRENCY PASSED"
else
  echo "QUOTA CONCURRENCY FAILED" >&2; exit 1
fi
