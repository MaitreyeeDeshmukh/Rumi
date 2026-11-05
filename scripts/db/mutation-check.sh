#!/usr/bin/env bash
# Proves the SQL tests bite: each mutation weakens one control inside a transaction, then a test file runs. Every
# mutation MUST make that test fail ("FAIL: ..."). Nothing is kept (the test files end in rollback, and a failed run closes
# the connection). LOCAL stack only.   Usage: scripts/db/mutation-check.sh
# (Concurrency controls - the quota lock and sort - are checked by scripts/db/quota-mutation-check.sh.)
set -uo pipefail
unset SUPABASE_DB_URL
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="${RUMI_DB_CONTAINER:-supabase_db_${project}}" # project_id from supabase/config.toml; RUMI_DB_CONTAINER overrides
docker ps --format '{{.Names}}' | grep -qx "$container" || { echo "local stack not running" >&2; exit 2; }

# patch <function signature> <exact text> <replacement>: rewrites a function body in place
patch() { printf "do \$m\$ declare d text; begin d := pg_get_functiondef('%s'::regprocedure); if position(\$a\$%s\$a\$ in d) = 0 then raise exception 'mutation target not found'; end if; execute replace(d, \$a\$%s\$a\$, \$b\$%s\$b\$); end \$m\$;\n" "$1" "$2" "$2" "$3"; }

names=(); sqls=(); tests=()
add() { names+=("$1"); sqls+=("$2"); tests+=("${3:-prod_v2}"); }   # add <name> <sql> [test file, default prod_v2]

# --- sign-up, persona, export
add "sign-up trigger without exception guard" "create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as \$f\$ begin insert into public.core_profiles (owner_id) values (new.id) on conflict do nothing; insert into public.core_settings (owner_id) values (new.id) on conflict do nothing; return new; end \$f\$;"
add "persona upsert without last-write-wins" "$(patch 'public.persona_upsert_facts(jsonb)' 'where excluded.client_updated_at > f.client_updated_at' '')"
add "persona upsert without 100 cap" "$(patch 'public.persona_upsert_facts(jsonb)' '> 100 then' '> 100000 then')"
add "persona upsert without 200 per person cap" "$(patch 'public.persona_upsert_facts(jsonb)' 'v_existing + v_new > 200' 'v_existing + v_new > 200000')"
add "persona upsert accepts infinity" "$(patch 'public.persona_upsert_facts(jsonb)' 'not isfinite(x.client_updated_at)' 'false')"
add "persona upsert without the 5 minute clamp" "$(patch 'public.persona_upsert_facts(jsonb)' "now() + interval '5 minutes'" "now() + interval '50 years'")"
add "persona forget leaves a row" "$(patch 'public.persona_forget_all()' 'delete from public.persona_facts where owner_id = v_uid;' "delete from public.persona_facts where owner_id = v_uid and kind <> 'pacing';")"
add "persona forget keeps tombstones" "$(patch 'public.persona_forget_all()' 'delete from public.persona_removed where owner_id = v_uid;' '')" quota_tombstone
add "persona shape check removed" "alter table public.persona_facts drop constraint persona_facts_shape_check;"
add "tombstone trigger dropped" "drop trigger persona_facts_tombstone on public.persona_facts;" quota_tombstone
add "tombstone trigger without the depth guard" "drop trigger persona_facts_tombstone on public.persona_facts; create trigger persona_facts_tombstone after delete on public.persona_facts for each row execute function private.persona_tombstone();" quota_tombstone
add "tombstone skip removed from the upsert" "$(patch 'public.persona_upsert_facts(jsonb)' 'r.removed_at >= b.client_updated_at' 'false')" quota_tombstone
add "export leaks other users (definer, no owner filter)" "$(patch 'public.core_export_my_data()' 'where owner_id = $1 limit 5001' 'where $1 is not null limit 5001')
alter function public.core_export_my_data() security definer;"
add "export not capped per table" "$(patch 'public.core_export_my_data()' 'filter (where rn <= 5000)' 'filter (where true)')"
add "export marked stable" "alter function public.core_export_my_data() stable;"

# --- timeouts, privileges, RLS
add "role timeout removed" "alter role authenticated reset statement_timeout;"
add "anon timeout raised" "alter role anon set statement_timeout = '8s';"
add "flags readable by users" "grant select on public.ops_feature_flags to authenticated;"
add "RLS off on a new partition table" "alter table public.ops_app_events_default disable row level security;"
add "function without search_path" "alter function public.persona_forget_all() reset search_path;"
add "ops function callable by users" "grant execute on function public.ops_log_app_event(text, text, text, text, text, text, smallint) to authenticated;"
add "quota function callable by users" "grant execute on function public.ops_take_ai_quota(text[], integer[]) to authenticated;"
add "maintenance step callable by users" "grant execute on function public.ops_maint_anon_purge() to authenticated;"
add "partition function callable by service_role" "grant execute on function public.ops_create_month_partition(text, date) to service_role;"
add "anon may call the export" "grant execute on function public.core_export_my_data() to anon;"
add "tombstone table readable by anon" "grant select on public.persona_removed to anon;"
add "new functions executable by anon again" "alter default privileges for role postgres in schema public grant execute on functions to anon;"
add "new functions executable by PUBLIC again" "alter default privileges for role postgres grant execute on functions to public;"
add "new tables reachable by anon again" "alter default privileges for role postgres in schema public grant select on tables to anon;"

# --- event formats and constraints
add "app event route check removed" "alter table public.ops_app_events drop constraint ops_app_events_route_check;"
add "app event fingerprint check removed" "alter table public.ops_app_events drop constraint ops_app_events_fingerprint_check;"
add "usage bucket check removed" "alter table public.ops_ai_usage_daily drop constraint ops_ai_usage_daily_bucket_v2_check;"
add "ai event outcome check removed" "alter table public.ops_ai_events drop constraint ops_ai_events_outcome_v2_check;"

# --- maintenance
add "maintenance does not drop old partitions" "$(patch 'public.ops_maint_retention()' "execute format('drop table if exists public.%I', r.relname);" 'null;')"
add "purge ignores the flag (dry run deletes)" "$(patch 'public.ops_maint_anon_purge()' 'if v_on then' 'if true then')"
add "purge reaches non-anonymous users" "$(patch 'private.anon_purge_candidate_ids(integer)' 'where u.is_anonymous' 'where true')"
add "purge ignores the last sign-in" "$(patch 'private.anon_purge_candidate_ids(integer)' 'coalesce(u.last_sign_in_at, u.created_at)' 'u.created_at')"
add "usage prune accepts 0 days" "$(patch 'public.ops_prune_ai_usage(integer)' 'p_keep_days < 1' 'p_keep_days < 0')"
add "pg_cron purge job removed" "select cron.unschedule('rumi-maint-anon-purge');"
add "pg_cron job without its statement_timeout" "select cron.alter_job((select jobid from cron.job where jobname = 'rumi-maint-prune'), command := 'select public.ops_maint_prune()');"
add "maintenance step not security definer" "alter function public.ops_maint_health() security invoker;"

# --- metric views
add "metric view readable by users" "grant select on public.ops_v_ai_daily to authenticated;" metrics_views
add "alert snapshot callable by users" "grant execute on function public.ops_alert_snapshot() to authenticated;" metrics_views
add "alert snapshot without the backlog" "$(patch 'public.ops_alert_snapshot()' "'anonymous_user_backlog'" "'anonymous_user_backlog_x'")" metrics_views

failed=0
for i in "${!names[@]}"; do
  out="$( { echo "begin;"; echo "${sqls[$i]}"; cat "supabase/tests/${tests[$i]}.sql"; } | docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -P pager=off 2>&1 )"
  if echo "$out" | grep -q "PASSED"; then
    echo "SURVIVED (test did not notice): ${names[$i]}"; failed=1
  elif echo "$out" | grep -q "mutation target not found"; then
    echo "BROKEN MUTATION (target text not found): ${names[$i]}"; failed=1
  else
    echo "caught: ${names[$i]}  ->  $(echo "$out" | grep -m1 -E 'ERROR' | cut -c1-110)"
  fi
done
exit $failed
