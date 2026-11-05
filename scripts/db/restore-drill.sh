#!/usr/bin/env bash
# Restore drill (LOCAL stack only; it RESETS the local database). Proves a dump taken by scripts/db/dump.sh
# brings the data back into a freshly migrated database, with RLS, identities and sequences intact.
#
# THE RESTORE PROCEDURE (same steps for a real disaster, on a NEW Supabase project):
#   1. create the project; apply all migrations:    npx supabase link --project-ref <new>; npx supabase db push
#      (the files A..E are applied in order; enable pg_cron first if the dashboard requires it)
#      (here: npx supabase db reset = migrations only, no data)
#   2. verify checksums:                            ( cd <dump dir> && sha256sum -c sha256-<stamp>.txt )
#   3. empty the rows the migrations seeded (the dump holds the real flag values), then load the data (public + auth):
#        psql "$NEW_DB_URL" -c 'truncate public.ops_feature_flags'
#        gunzip -c data-<stamp>.sql.gz | psql "$NEW_DB_URL" -v ON_ERROR_STOP=1
#   4. check counts and sign in as a test user; flip flags back on if you turned them off.
# The data file already disables triggers while loading, so the sign-up trigger does not fire again. The dump has no
# sessions or tokens: everybody signs in again (anonymous users get a new session; their data is still theirs by id).
# An OLD dump resurrects people who deleted their data since: re-run those deletions before reopening the app.
set -euo pipefail
unset SUPABASE_DB_URL PGPASSWORD   # this drill only ever touches the local stack
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="${RUMI_DB_CONTAINER:-supabase_db_${project}}" # project_id from supabase/config.toml; RUMI_DB_CONTAINER overrides
psql_() { docker exec -i "$container" psql -U postgres -d postgres -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
q() { echo "$1" | psql_; }
expect() { [ "$2" = "$3" ] || { echo "DRILL FAILED: $1 (got '$2', expected '$3')" >&2; exit 1; }; echo "ok: $1"; }
fingerprint() { q "select md5(concat_ws('|',
  (select string_agg(id::text, ',' order by id) from auth.users where id::text like 'd0000000-%'),
  (select string_agg(owner_id::text || title, ',' order by id) from public.plan_visit_plans),
  (select string_agg(owner_id::text || kind || key || coalesce(level::text, '-'), ',' order by id) from public.persona_facts),
  (select string_agg(owner_id::text || kind || granted::text, ',' order by owner_id, kind) from public.core_consents),
  (select count(*)::text from public.core_profiles), (select count(*)::text from public.core_settings)))"; }

dumpdir="$(mktemp -d)"; trap 'rm -rf "$dumpdir"' EXIT

echo "== 1. clean database with drill data"
npx supabase db reset --local --yes >/dev/null 2>&1
psql_ <<'SQL'
insert into auth.users (id, is_anonymous) values
  ('d0000000-0000-0000-0000-000000000001', true), ('d0000000-0000-0000-0000-000000000002', true);
insert into public.core_consents (owner_id, kind, granted, policy_version) values
  ('d0000000-0000-0000-0000-000000000001', 'cloud_sync', true, 'v1'),
  ('d0000000-0000-0000-0000-000000000001', 'persona_memory', true, 'v1'),
  ('d0000000-0000-0000-0000-000000000002', 'cloud_sync', true, 'v1');
insert into public.plan_visit_plans (owner_id, title) values
  ('d0000000-0000-0000-0000-000000000001', 'plan of one'), ('d0000000-0000-0000-0000-000000000002', 'plan of two');
insert into public.plan_items (owner_id, plan_id, position, local_id, text, kind, source)
  select owner_id, id, 0, 'q0', 'a question', 'question', 'user' from public.plan_visit_plans;
insert into public.persona_facts (owner_id, kind, key, level) values
  ('d0000000-0000-0000-0000-000000000001', 'pacing', 'one_question', null),
  ('d0000000-0000-0000-0000-000000000001', 'help_level', 'question', 2);
SQL
before="$(fingerprint)"; echo "fingerprint before: $before"

echo "== 2. dump (scripts/db/dump.sh)"
env -u SUPABASE_DB_URL DUMP_DIR="$dumpdir" bash scripts/db/dump.sh
( cd "$dumpdir" && sha256sum -c sha256-*.txt >/dev/null ) && echo "ok: checksums verify"

echo "== 3. disaster: database rebuilt from migrations only (no data)"
npx supabase db reset --local --yes >/dev/null 2>&1
expect "drill users are gone" "$(q "select count(*) from auth.users where id::text like 'd0000000-%'")" "0"

echo "== 4. restore data from the dump"
echo "truncate public.ops_feature_flags;" | psql_            # rows seeded by migration 2; the dump carries the real values
gunzip -c "$dumpdir"/data-*.sql.gz | psql_ >/dev/null
after="$(fingerprint)"; echo "fingerprint after:  $after"
expect "restored data is identical" "$after" "$before"
expect "plans restored" "$(q "select count(*) from public.plan_visit_plans")" "2"

echo "== 5. the restored database behaves: RLS, sequences, sign-up trigger"
expect "user one sees only own plan (RLS)" "$(psql_ <<'SQL'
begin; set local role authenticated; set local "request.jwt.claims" = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select count(*) from public.plan_visit_plans; rollback;
SQL
)" "1"
expect "identity sequence continues (new plan item insert works)" "$(psql_ <<'SQL'
insert into public.plan_items (owner_id, plan_id, position, local_id, text, kind, source)
  select owner_id, id, 1, 'q1', 'another', 'question', 'user' from public.plan_visit_plans where title = 'plan of one';
select count(*) from public.plan_items;
SQL
)" "3"
expect "sign-up trigger works after restore" "$(psql_ <<'SQL'
insert into auth.users (id) values ('d0000000-0000-0000-0000-000000000009');
select count(*) from public.core_profiles where owner_id = 'd0000000-0000-0000-0000-000000000009';
SQL
)" "1"
echo "RESTORE DRILL PASSED"
