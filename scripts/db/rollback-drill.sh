#!/usr/bin/env bash
# Bad-migration drill (LOCAL stack only; it RESETS the local database).
#   1. reset to v1 and put real data in it (including a retired persona kind)
#   2. apply migration v2 plus one deliberately failing statement in ONE transaction -> must fail and leave v1 untouched
#   3. apply the real migration v2 the same way -> must succeed on top of data, retire the old kind, keep the rest
# Proves: a failed migration changes nothing (tables, constraints, columns, extension, cron job, role settings, data),
# and the good migration upgrades a populated v1 database. Usage: scripts/db/rollback-drill.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="supabase_db_${project}"
v2=supabase/migrations/20261105120000_rumi_production_v2.sql
psql_() { docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
q() { echo "$1" | psql_; }
expect() { [ "$2" = "$3" ] || { echo "DRILL FAILED: $1 (got '$2', expected '$3')" >&2; exit 1; }; echo "ok: $1"; }

echo "== 1. reset to v1 and load data"
npx supabase db reset --version 20261105000000 --yes >/dev/null 2>&1
psql_ <<'SQL'
insert into auth.users (id) values ('eeeeeeee-0000-0000-0000-00000000000e');
insert into public.core_consents (owner_id, kind, granted, policy_version) values ('eeeeeeee-0000-0000-0000-00000000000e', 'persona_memory', true, 'v1');
insert into public.persona_facts (owner_id, kind, key, level) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'focus_pref', 'old_focus', null),
  ('eeeeeeee-0000-0000-0000-00000000000e', 'support_pref', 'quiet_room', null);
SQL
expect "v1 has no ops_feature_flags" "$(q "select to_regclass('public.ops_feature_flags') is null")" "t"

echo "== 2. failing migration (v2 + one bad statement), single transaction"
bad="$(mktemp)"; trap 'rm -f "$bad"' EXIT
{ cat "$v2"; echo "alter table public.core_settings add constraint drill_bad check (theme = 'never');"; } > "$bad"
if psql_ --single-transaction -f "$bad" >/dev/null 2>&1; then echo "DRILL FAILED: the bad migration was accepted" >&2; exit 1; fi
echo "ok: bad migration was rejected"
expect "no ops_feature_flags after failure" "$(q "select to_regclass('public.ops_feature_flags') is null")" "t"
expect "no ops_app_events after failure" "$(q "select to_regclass('public.ops_app_events') is null")" "t"
expect "no client_updated_at column after failure" "$(q "select count(*) from information_schema.columns where table_name='persona_facts' and column_name='client_updated_at'")" "0"
expect "old kind check still in force" "$(q "select count(*) from pg_constraint where conname='persona_facts_kind_check' and conrelid='public.persona_facts'::regclass")" "1"
expect "old outcome check still in force" "$(q "select count(*) from pg_constraint where conname='ops_ai_events_outcome_check' and conrelid='public.ops_ai_events'::regclass")" "1"
expect "no pg_cron extension after failure" "$(q "select count(*) from pg_extension where extname='pg_cron'")" "0"
expect "no new role settings after failure" "$(q "select count(*) from pg_db_role_setting d join pg_roles r on r.oid=d.setrole where r.rolname in ('anon','authenticated') and (d.setconfig::text like '%idle_in_transaction%' or d.setconfig::text like '%lock_timeout%')")" "0"
expect "retired-kind row still there (delete rolled back)" "$(q "select count(*) from public.persona_facts where kind='focus_pref'")" "1"
expect "sign-up trigger is still the v1 one" "$(q "select position('exception' in pg_get_functiondef('private.handle_new_user()'::regprocedure))")" "0"

echo "== 3. real migration on the populated v1 database"
psql_ --single-transaction -f "$v2" >/dev/null
expect "flags seeded" "$(q "select count(*) from public.ops_feature_flags where enabled")" "3"
expect "retired kind removed" "$(q "select count(*) from public.persona_facts where kind='focus_pref'")" "0"
expect "valid kind kept" "$(q "select count(*) from public.persona_facts where kind='support_pref' and key='quiet_room'")" "1"
expect "existing rows got client_updated_at" "$(q "select count(*) from public.persona_facts where client_updated_at is not null")" "1"
expect "all constraints validated" "$(q "select count(*) from pg_constraint where conrelid in ('public.persona_facts'::regclass,'public.ops_ai_events'::regclass) and not convalidated")" "0"
expect "cron job scheduled" "$(q "select count(*) from cron.job where jobname='rumi-ops-maintenance-daily'")" "1"
psql_ --single-transaction -f supabase/migrations/20261105130000_rumi_metric_views.sql >/dev/null
psql_ --single-transaction -f supabase/migrations/20261105140000_rumi_quota_and_tombstones.sql >/dev/null
expect "later migrations apply on top (quota function, tombstone table)" "$(q "select (to_regprocedure('public.ops_take_ai_quota(text[],integer[])') is not null and to_regclass('public.persona_removed') is not null and to_regclass('public.ops_v_ai_daily') is not null)::text")" "true"
echo "ROLLBACK DRILL PASSED"
