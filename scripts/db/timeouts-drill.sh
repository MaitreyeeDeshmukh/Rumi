#!/usr/bin/env bash
# Timeout drill (LOCAL stack only): the values stored on role `authenticated` really stop a runaway query, a
# forgotten open transaction and a lock wait. PostgREST applies the role's settings to each request; here the same
# values are passed to a plain session with PGOPTIONS. Takes about 50 seconds. Usage: scripts/db/timeouts-drill.sh
set -uo pipefail
unset SUPABASE_DB_URL
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="supabase_db_${project}"
run() { docker exec -i -e PGOPTIONS="$1" "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 2>&1; }
cfg() { echo "select substring(c from '=(.*)$') from pg_db_role_setting d join pg_roles r on r.oid = d.setrole, unnest(d.setconfig) c where r.rolname = 'authenticated' and c like '$1=%'" \
        | docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A; }
st="$(cfg statement_timeout)"; idle="$(cfg idle_in_transaction_session_timeout)"; lock="$(cfg lock_timeout)"
echo "authenticated: statement_timeout=$st idle_in_transaction_session_timeout=$idle lock_timeout=$lock"
[ -n "$st" ] && [ -n "$idle" ] && [ -n "$lock" ] || { echo "DRILL FAILED: role settings missing" >&2; exit 1; }

echo "== runaway query (pg_sleep 30) must be cancelled after $st"
start=$SECONDS
out="$(echo "select pg_sleep(30);" | run "-c statement_timeout=$st")"; took=$((SECONDS - start))
echo "$out" | grep -q "statement timeout" && [ "$took" -lt 27 ] || { echo "DRILL FAILED: query not cancelled ($took s): $out" >&2; exit 1; }
echo "ok: cancelled after ${took}s"

echo "== open transaction left idle must be killed after $idle"
start=$SECONDS
out="$( (echo "begin; select 1;"; sleep 36; echo "select 2;") | run "-c idle_in_transaction_session_timeout=$idle" )"; took=$((SECONDS - start))
echo "$out" | grep -qi "idle-in-transaction" || { echo "DRILL FAILED: idle transaction survived ($took s): $out" >&2; exit 1; }
echo "ok: connection terminated (${took}s)"

echo "== lock wait must give up after $lock (a migration or job holds an exclusive lock)"
( echo "begin; lock table public.core_profiles in access exclusive mode; select pg_sleep(14); rollback;" | run "" >/dev/null ) &
holder=$!
sleep 2
start=$SECONDS
out="$(echo "select count(*) from public.core_profiles;" | run "-c lock_timeout=$lock")"; took=$((SECONDS - start))
wait "$holder" || true
echo "$out" | grep -q "lock timeout" && [ "$took" -lt 14 ] || { echo "DRILL FAILED: lock wait not limited ($took s): $out" >&2; exit 1; }
echo "ok: gave up after ${took}s"
echo "TIMEOUT DRILL PASSED"
