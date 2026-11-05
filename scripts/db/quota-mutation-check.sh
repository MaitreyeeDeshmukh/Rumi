#!/usr/bin/env bash
# Proves quota-concurrency.sh bites: weakens ops_take_ai_quota in the LOCAL database (no lock / no internal sort),
# the concurrency script MUST then fail, and the real function is restored from migration A afterwards.
# Usage: scripts/db/quota-mutation-check.sh
set -uo pipefail
unset SUPABASE_DB_URL
cd "$(dirname "$0")/../.."
project="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml | head -1)"
container="supabase_db_${project}"
mig=supabase/migrations/20261105120000_rumi_prod_a_objects.sql
sql() { docker exec -i "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
restore() { awk '/^create or replace function public.ops_take_ai_quota/{p=1} p{print} p&&/^end \$\$;/{exit}' "$mig" | sql; }
patch() { # patch <exact text> <replacement>
  printf "do \$m\$ declare d text; begin d := pg_get_functiondef('public.ops_take_ai_quota(text[],integer[])'::regprocedure); if position(\$a\$%s\$a\$ in d) = 0 then raise exception 'mutation target not found'; end if; execute replace(d, \$a\$%s\$a\$, \$b\$%s\$b\$); end \$m\$;\n" "$1" "$1" "$2" | sql
}
trap restore EXIT
fail=0
check() { # check <name>
  if bash scripts/db/quota-concurrency.sh >/tmp/qm.out 2>&1; then echo "SURVIVED (concurrency test did not notice): $1"; fail=1; else echo "caught: $1  ->  $(grep -E 'phase|FAILED|true=' /tmp/qm.out | head -2 | tr '\n' ' ' | cut -c1-140)"; fi
}
patch 'perform pg_advisory_xact_lock(hashtext(v_day::text), hashtext(v_b[i]));' 'null;' && check "no advisory lock"; restore
patch 'array_agg(x.b order by x.b collate "C"), array_agg(x.l order by x.b collate "C")' 'array_agg(x.b), array_agg(x.l)' && check "buckets not sorted inside the function"; restore
exit $fail
