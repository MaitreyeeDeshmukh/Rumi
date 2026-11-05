#!/usr/bin/env bash
# Maintenance drill (LOCAL stack only; it changes the local database and cleans up after itself).
#  1. a manual run cannot race the cron run: while another session holds a step's advisory lock the step skips and says so
#  2. a role-level statement_timeout on postgres (here 30 ms) cannot cancel a step when it is run with its CRON COMMAND
#     (which sets its own statement_timeout first): 3000 stale anonymous users are purged in batches of 2000
#  3. the same step called WITHOUT that SET is cancelled by the role setting (proves the cron command's SET matters;
#     a function cannot pin statement_timeout itself because the timer of the calling statement is already running)
# Usage: scripts/db/maint-drill.sh
set -uo pipefail
unset SUPABASE_DB_URL
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="supabase_db_${project}"
psql_() { docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
q() { echo "$1" | psql_; }
fast() { echo "$1" | docker exec -i -e PGOPTIONS="-c statement_timeout=0" "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1; }
expect() { [ "$2" = "$3" ] || { echo "DRILL FAILED: $1 (got '$2', expected '$3')" >&2; exit 1; }; echo "ok: $1"; }
cleanup() {
  fast "alter role postgres reset statement_timeout" >/dev/null 2>&1
  fast "update public.ops_feature_flags set enabled = false where key = 'anon_purge_enabled'; delete from auth.users where id::text like 'd5000000-%'; delete from public.ops_app_events where code like 'maintenance%' or code like 'anon_purge%'" >/dev/null 2>&1
}
trap cleanup EXIT

echo "== 1. advisory lock: a second run skips"
( echo "select pg_advisory_lock(hashtext('rumi_maint'), hashtext('prune')); select pg_sleep(8);" | docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A >/dev/null 2>&1 ) &
sleep 2
expect "the step skips while another run holds its lock" "$(q "select public.ops_maint_prune()")" '{"skipped": true}'
expect "the skip is logged" "$(q "select count(*) from public.ops_app_events where code = 'maintenance_skipped_locked' and fingerprint = 'prune'")" "1"
wait
expect "after the other run is done the step runs" "$(q "select (public.ops_maint_prune() ? 'pruned_usage_rows')::text")" "true"

echo "== 2. the cron command survives a role-level statement_timeout"
fast "alter table public.core_settings disable trigger core_settings_touch;
insert into auth.users (id, is_anonymous, created_at) select ('d5000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, true, now() - interval '100 days' from generate_series(1, 3000) g;
update public.core_settings set updated_at = now() - interval '100 days' where owner_id::text like 'd5000000-%';
alter table public.core_settings enable trigger core_settings_touch;
update public.ops_feature_flags set enabled = true where key = 'anon_purge_enabled';
alter role postgres set statement_timeout = '30ms';" >/dev/null
expect "the role setting is in force for new sessions" "$(q "show statement_timeout")" "30ms"
cmd="$(fast "select command from cron.job where jobname = 'rumi-maint-anon-purge'")"
run_cron() { docker exec "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 -c "$cmd" 2>&1; }
expect "a batch of 2000 is purged although the role limit is 30 ms" "$(run_cron | grep -o '"purged_anonymous_users": [0-9]*')" '"purged_anonymous_users": 2000'
expect "the second run purges the remaining 1000" "$(run_cron | grep -o '"purged_anonymous_users": [0-9]*')" '"purged_anonymous_users": 1000'

echo "== 3. the bare function call is cancelled by the same role setting"
fast "insert into auth.users (id, is_anonymous, created_at) select ('d5000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, true, now() - interval '100 days' from generate_series(1, 3000) g;
alter table public.core_settings disable trigger core_settings_touch;
update public.core_settings set updated_at = now() - interval '100 days' where owner_id::text like 'd5000000-%';
alter table public.core_settings enable trigger core_settings_touch;" >/dev/null
if err="$(q "select public.ops_maint_anon_purge()" 2>&1)"; then echo "DRILL FAILED: the bare call survived a 30 ms role timeout: $err" >&2; exit 1; fi
echo "$err" | grep -q "statement timeout" || { echo "DRILL FAILED: wrong error: $err" >&2; exit 1; }
echo "ok: without the SET in the cron command the step is cancelled (so the SET matters)"
echo "MAINTENANCE DRILL PASSED"
