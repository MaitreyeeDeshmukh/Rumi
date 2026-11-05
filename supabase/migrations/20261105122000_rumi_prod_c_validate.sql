-- Rumi production migration C of E: VALIDATE the constraints added NOT VALID in file B, then drop the superseded ones.
-- One transaction. VALIDATE CONSTRAINT scans the table but takes only SHARE UPDATE EXCLUSIVE, so reads and writes
-- continue; the statement timeout is generous because the scan is the work. Dropping a constraint needs a brief
-- exclusive lock, which gives up after 3 s instead of queueing. A row that breaks a new rule fails this file with the
-- constraint name (fix the row, apply again).
set local lock_timeout = '3s';
set local statement_timeout = '10min';

do $$
declare c record;
begin
  for c in select * from (values
    ('public.ops_ai_events', 'ops_ai_events_outcome_v2_check'),
    ('public.ops_ai_events', 'ops_ai_events_cache_status_check'),
    ('public.ops_ai_events', 'ops_ai_events_cached_tokens_check'),
    ('public.ops_ai_events', 'ops_ai_events_bucket_shape_check'),
    ('public.persona_facts', 'persona_facts_shape_check'),
    ('public.ops_ai_usage_daily', 'ops_ai_usage_daily_bucket_v2_check')
  ) as v(tbl, name)
  loop
    if exists (select 1 from pg_constraint where conname = c.name and conrelid = c.tbl::regclass and not convalidated) then
      execute format('alter table %s validate constraint %I', c.tbl, c.name);
    end if;
  end loop;
end $$;

-- Superseded by the checks above (each new check allows everything the old one did that is still valid).
alter table public.ops_ai_events drop constraint if exists ops_ai_events_outcome_check;
alter table public.persona_facts drop constraint if exists persona_facts_kind_check;
alter table public.ops_ai_usage_daily drop constraint if exists ops_ai_usage_daily_bucket_check;
