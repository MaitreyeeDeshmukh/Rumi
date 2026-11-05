#!/usr/bin/env bash
# Proves the tests bite: each mutation weakens one control inside a transaction, then supabase/tests/prod_v2.sql
# runs. Every mutation MUST make the test fail ("FAIL: ..."). Nothing is kept (the test file ends in rollback, and
# a failed run closes the connection). LOCAL stack only.   Usage: scripts/db/mutation-check.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="supabase_db_${project}"
docker ps --format '{{.Names}}' | grep -qx "$container" || { echo "local stack not running" >&2; exit 2; }

# patch <function signature> <exact text> <replacement>: rewrites a function body in place
patch() { printf "do \$m\$ declare d text; begin d := pg_get_functiondef('%s'::regprocedure); if position(\$a\$%s\$a\$ in d) = 0 then raise exception 'mutation target not found'; end if; execute replace(d, \$a\$%s\$a\$, \$b\$%s\$b\$); end \$m\$;\n" "$1" "$2" "$2" "$3"; }

names=(); sqls=()
add() { names+=("$1"); sqls+=("$2"); }

add "sign-up trigger without exception guard" "create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as \$f\$ begin insert into public.core_profiles (owner_id) values (new.id) on conflict do nothing; insert into public.core_settings (owner_id) values (new.id) on conflict do nothing; return new; end \$f\$;"
add "persona upsert without last-write-wins" "$(patch 'public.persona_upsert_facts(jsonb)' 'where excluded.client_updated_at > f.client_updated_at' '')"
add "persona upsert without 100 cap" "$(patch 'public.persona_upsert_facts(jsonb)' '> 100 then' '> 100000 then')"
add "persona forget leaves a row" "$(patch 'public.persona_forget_all()' 'delete from public.persona_facts where owner_id = v_uid;' "delete from public.persona_facts where owner_id = v_uid and kind <> 'pacing';")"
add "flags readable by users" "grant select on public.ops_feature_flags to authenticated;"
add "export leaks other users (definer, no owner filter)" "$(patch 'public.core_export_my_data()' 'where r.owner_id = $1' 'where $1 is not null')
alter function public.core_export_my_data() security definer;"
add "role timeout removed" "alter role authenticated reset statement_timeout;"
add "maintenance does not drop old partitions" "$(patch 'public.ops_maintenance_daily()' "execute format('drop table public.%I', r.relname);" 'null;')"
add "maintenance purges non-anonymous users" "$(patch 'public.ops_maintenance_daily()' 'where u.is_anonymous and' 'where')"
add "maintenance purges recently active anonymous users" "$(patch 'public.ops_maintenance_daily()' 'coalesce(u.last_sign_in_at, u.created_at)' 'u.created_at')"
add "RLS off on a new partition table" "alter table public.ops_app_events_default disable row level security;"
add "function without search_path" "alter function public.persona_forget_all() reset search_path;"
add "ops function callable by users" "grant execute on function public.ops_log_app_event(text, text, text, text, text, text, smallint) to authenticated;"
add "anon may call the export" "grant execute on function public.core_export_my_data() to anon;"
add "pg_cron job removed" "select cron.unschedule('rumi-ops-maintenance-daily');"

failed=0
for i in "${!names[@]}"; do
  out="$( { echo "begin;"; echo "${sqls[$i]}"; cat supabase/tests/prod_v2.sql; } | docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -P pager=off 2>&1 )"
  if echo "$out" | grep -q "ALL PROD V2 TESTS PASSED"; then
    echo "SURVIVED (test did not notice): ${names[$i]}"; failed=1
  else
    echo "caught: ${names[$i]}  ->  $(echo "$out" | grep -m1 -E 'ERROR' | cut -c1-110)"
  fi
done
exit $failed
