#!/usr/bin/env bash
# Migration drill (LOCAL stack only; it RESETS the local database). For every production migration file, in order:
#   ATOMIC  the file plus one failing statement, in one transaction, must fail and leave NOTHING of the file behind
#   LOCK    while another session holds a write lock on persona_facts and ops_ai_events (an in-flight write), the file
#           must give up within seconds with "lock timeout" instead of queueing behind it, and leave nothing behind
#   APPLY   then the real file applies
# Extra for file B (the data guard): with a retired-kind row present, B refuses and says so; after the operator removes
# the row on purpose, B applies. Starts from v1 WITH data, so the whole set is also proven on a populated database.
# Usage: scripts/db/rollback-drill.sh
set -euo pipefail
unset SUPABASE_DB_URL
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="${RUMI_DB_CONTAINER:-supabase_db_${project}}" # project_id from supabase/config.toml; RUMI_DB_CONTAINER overrides
mig=supabase/migrations
A=$mig/20261105120000_rumi_prod_a_objects.sql
B=$mig/20261105121000_rumi_prod_b_constraints_not_valid.sql
C=$mig/20261105122000_rumi_prod_c_validate.sql
D=$mig/20261105123000_rumi_prod_d_triggers.sql
E=$mig/20261105124000_rumi_prod_e_cron_and_roles.sql
M=$mig/20261105130000_rumi_metric_views.sql
psql_() { docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
q() { echo "$1" | psql_; }
expect() { [ "$2" = "$3" ] || { echo "DRILL FAILED: $1 (got '$2', expected '$3')" >&2; exit 1; }; echo "ok: $1"; }
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT

# probes: 't' when the file's effect is present
applied_A() { q "select (to_regclass('public.ops_feature_flags') is not null or to_regclass('public.persona_removed') is not null)::text"; }
applied_B() { q "select exists (select 1 from pg_constraint where conname = 'ops_ai_events_outcome_v2_check' or conname = 'persona_facts_shape_check')::text"; }
applied_C() { q "select (not exists (select 1 from pg_constraint where conname = 'ops_ai_events_outcome_check'))::text"; }
applied_D() { q "select exists (select 1 from pg_trigger where tgname = 'persona_facts_tombstone')::text"; }
applied_E() { q "select (exists (select 1 from pg_extension where extname = 'pg_cron') or exists (select 1 from pg_db_role_setting d join pg_roles r on r.oid = d.setrole where r.rolname = 'authenticated' and d.setconfig::text like '%lock_timeout%'))::text"; }
applied_M() { q "select (to_regclass('public.ops_v_ai_daily') is not null)::text"; }

atomic() { # atomic <name> <file> <probe>
  { cat "$2"; echo "select 1/0;"; } > "$tmp"
  if err="$(psql_ --single-transaction -f - < "$tmp" 2>&1)"; then echo "DRILL FAILED: $1 + a failing statement was accepted" >&2; exit 1; fi
  echo "$err" | grep -q "division by zero" || { echo "DRILL FAILED: $1 rejected for the wrong reason: $err" >&2; exit 1; }
  expect "$1 is atomic: nothing of it is left after a failure" "$($3)" "false"
}
locked() { # locked <name> <file> <probe>: another session holds ROW EXCLUSIVE on the busy tables
  ( printf '%s\n' "begin;" "lock table public.persona_facts in row exclusive mode;" "lock table public.ops_ai_events in row exclusive mode;" "select pg_sleep(60);" \
      | docker exec -i -e PGAPPNAME=drill_holder "$container" psql -U postgres -d postgres -X -q -t -A >/dev/null 2>&1 ) &
  local holder=$!
  until [ "$(q "select count(*) from pg_locks l join pg_stat_activity a using (pid) where a.application_name = 'drill_holder' and l.mode = 'RowExclusiveLock' and l.granted")" -ge 2 ]; do sleep 1; done
  local start=$SECONDS
  err="$(psql_ --single-transaction -f - < "$2" 2>&1)" && { echo "DRILL FAILED: $1 was applied while the tables were busy" >&2; exit 1; }
  local took=$((SECONDS - start))
  q "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'drill_holder'" >/dev/null
  wait "$holder" 2>/dev/null || true
  echo "$err" | grep -q "lock timeout" && [ "$took" -lt 12 ] || { echo "DRILL FAILED: $1 did not fail fast on the lock ($took s): $err" >&2; exit 1; }
  echo "ok: $1 gave up after ${took}s on a busy table (lock timeout) instead of queueing"
  expect "$1 left nothing behind after the lock timeout" "$($3)" "false"
}
apply() { psql_ --single-transaction -f - < "$1" >/dev/null; expect "$2 applied" "$($3)" "true"; }

echo "== 0. reset to v1 and load data"
npx supabase db reset --local --version 20261105000000 --yes >/dev/null 2>&1
psql_ <<'SQL'
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-00000000000e');
insert into public.core_consents (owner_id, kind, granted, policy_version) values ('eeeeeeee-0000-0000-0000-00000000000e', 'persona_memory', true, 'v1');
insert into public.persona_facts (owner_id, kind, key, level) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'focus_pref', 'old_focus', null),
  ('eeeeeeee-0000-0000-0000-00000000000e', 'support_pref', 'p1', null);
SQL
expect "v1 has none of the production objects" "$(applied_A)$(applied_B)$(applied_E)$(applied_M)" "falsefalsefalsefalse"

echo "== A. additive objects"
atomic "A" "$A" applied_A
locked "A" "$A" applied_A
apply "$A" "A" applied_A

echo "== B. NOT VALID constraints (guard: rows outside the new shape stop it, nothing is deleted)"
if err="$(psql_ --single-transaction -f - < "$B" 2>&1)"; then echo "DRILL FAILED: B ran with a retired-kind row present" >&2; exit 1; fi
echo "$err" | grep -q "focus_pref" || { echo "DRILL FAILED: B's refusal does not name the retired kind: $err" >&2; exit 1; }
echo "ok: B refused with a clear message while a focus_pref row exists"
expect "B changed nothing when it refused" "$(applied_B)" "false"
expect "the retired-kind row is still there (B never deletes)" "$(q "select count(*) from public.persona_facts where kind = 'focus_pref'")" "1"
q "delete from public.persona_facts where kind = 'focus_pref'" >/dev/null   # the operator's decision
atomic "B" "$B" applied_B
locked "B" "$B" applied_B
apply "$B" "B" applied_B
expect "B constraints are NOT VALID until C (new writes are checked, old rows not yet)" "$(q "select count(*) from pg_constraint where conname in ('ops_ai_events_outcome_v2_check', 'persona_facts_shape_check') and conrelid in ('public.ops_ai_events'::regclass, 'public.persona_facts'::regclass) and not convalidated")" "2"

echo "== C. VALIDATE and drop superseded constraints"
atomic "C" "$C" applied_C
locked "C" "$C" applied_C
expect "C rolled back as a whole: the new constraint is still NOT VALID" "$(q "select count(*) from pg_constraint where conname = 'ops_ai_events_outcome_v2_check' and conrelid = 'public.ops_ai_events'::regclass and not convalidated")" "1"
apply "$C" "C" applied_C
expect "all constraints validated after C" "$(q "select count(*) from pg_constraint where conrelid in ('public.persona_facts'::regclass, 'public.ops_ai_events'::regclass, 'public.ops_ai_usage_daily'::regclass) and not convalidated")" "0"

echo "== D. triggers"
atomic "D" "$D" applied_D
locked "D" "$D" applied_D
apply "$D" "D" applied_D

echo "== E. cron, role settings, default privileges"
atomic "E" "$E" applied_E
expect "E left no default-privilege change after a failure" "$(q "select count(*) from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 0 and defaclobjtype = 'f'")" "0"
apply "$E" "E" applied_E
expect "five cron jobs scheduled" "$(q "select count(*) from cron.job where jobname like 'rumi-maint-%'")" "5"

echo "== metric views"
atomic "metric views" "$M" applied_M
apply "$M" "metric views" applied_M

echo "== the set, on the populated database"
expect "flags seeded (anon purge off)" "$(q "select string_agg(key || '=' || enabled::text, ',' order by key) from public.ops_feature_flags")" "ai_enabled=true,anon_purge_enabled=false,cloud_sync_enabled=true,memory_sync_enabled=true"
expect "valid persona row kept" "$(q "select count(*) from public.persona_facts where kind = 'support_pref' and key = 'p1'")" "1"
expect "existing rows got client_updated_at" "$(q "select count(*) from public.persona_facts where client_updated_at is not null")" "1"
echo "ROLLBACK DRILL PASSED"
