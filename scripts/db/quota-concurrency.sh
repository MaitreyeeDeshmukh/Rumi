#!/usr/bin/env bash
# Concurrency test for ops_take_ai_quota on the LOCAL stack: 24 parallel sessions race for a quota of 7 on one
# bucket. Callers 1-12 also take a second bucket (limit 10), callers 13-24 only the first.
# Exactly 7 calls may succeed, the first bucket must count exactly 7, and the second bucket must count exactly
# the successful callers among 1-12 (a refused call must not leave a count behind).
# Each session holds its transaction open 1 s after a successful take, to widen the race window.
# Phase 2 is a deterministic deadlock check: the caller passes its buckets in REVERSE order while another transaction holds
# the first one; the function must sort them itself (lock the first one first), so nobody deadlocks.
# Usage: scripts/db/quota-concurrency.sh
set -uo pipefail
unset SUPABASE_DB_URL
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="supabase_db_${project}"
sql() { docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
hex=$(printf '%08x' $$); bucket="u:$hex"; shared="ip:$hex"
cleanup() { echo "delete from public.ops_ai_usage_daily where bucket in ('$bucket', '$shared', 'u:0000000a', 'u:0000000b')" | sql >/dev/null; }
trap cleanup EXIT
dir="$(mktemp -d)"
# A gate (advisory lock 777) holds all 24 sessions at the starting line; when it opens they hit the function together.
( printf '%s
' "select pg_advisory_lock(777);" "select pg_sleep(8);" | sql >/dev/null 2>&1 ) &
sleep 1
for i in $(seq 1 24); do
  if [ "$i" -le 12 ]; then call="array['$bucket','$shared'], array[7,10]"; else call="array['$bucket'], array[7]"; fi
  # a successful session keeps its transaction open 0.15 s, so without the quota's own lock many sessions would read the
  # same count and all succeed (the race this test exists to catch). 7 x 0.15 s stays far below the 2 s lock timeout.
  ( printf '%s
' "begin;" "select pg_advisory_xact_lock_shared(777);" "set local role service_role;" "select public.ops_take_ai_quota($call) as ok \gset" "\if :ok" "select pg_sleep(0.15);" "\endif" "commit;" "\echo :ok" | sql > "$dir/$i.out" 2>&1 ) &
done
wait
trues=$(cat "$dir"/[0-9]*.out | grep -c '^t$'); falses=$(cat "$dir"/[0-9]*.out | grep -c '^f$')
errs=$(cat "$dir"/[0-9]*.out | grep -vcE '^(t|f|SET)?$')
first12=$(for i in $(seq 1 12); do cat "$dir/$i.out"; done | grep -c '^t$')
used=$(echo "select coalesce(sum(calls),0) from public.ops_ai_usage_daily where bucket='$bucket' and day=(now() at time zone 'utc')::date" | sql)
used2=$(echo "select coalesce(sum(calls),0) from public.ops_ai_usage_daily where bucket='$shared' and day=(now() at time zone 'utc')::date" | sql)
echo "true=$trues false=$falses errors=$errs counted(bucket)=$used counted(shared)=$used2 true-among-first-12=$first12"
ok1=0
if [ "$errs" = 0 ] && [ "$trues" = 7 ] && [ "$used" = 7 ] && [ "$used2" = "$first12" ] && [ "$((trues + falses))" = 24 ]; then ok1=1; echo "phase 1 ok: exactly 7 of 24 got the quota"; fi

# phase 2: deadlock check. Session 1 holds bucket A, sleeps, then wants bucket B. Session 2 asks for [B, A] (reverse order).
day="(now() at time zone 'utc')::date::text"
( printf '%s
' "begin;" "select pg_advisory_xact_lock(hashtext($day), hashtext('u:0000000a'));" "select pg_sleep(2);"     "select pg_advisory_xact_lock(hashtext($day), hashtext('u:0000000b'));" "commit;" "\echo holder-ok" | sql > "$dir/s1.out" 2>&1 ) &
sleep 0.7
echo "set role service_role; select public.ops_take_ai_quota(array['u:0000000b','u:0000000a'], array[100,100]);" | sql > "$dir/s2.out" 2>&1
wait
if grep -q holder-ok "$dir/s1.out" && grep -q '^t$' "$dir/s2.out" && ! grep -qiE 'deadlock|40P01|lock timeout' "$dir"/s1.out "$dir"/s2.out; then
  echo "phase 2 ok: reversed caller order did not deadlock"
  ok2=1
else
  echo "phase 2 FAILED: $(cat "$dir/s1.out" "$dir/s2.out" | tr '
' ' ' | cut -c1-300)" >&2; ok2=0
fi
if [ "$ok1" = 1 ] && [ "$ok2" = 1 ]; then echo "QUOTA CONCURRENCY PASSED"; else echo "QUOTA CONCURRENCY FAILED" >&2; exit 1; fi
