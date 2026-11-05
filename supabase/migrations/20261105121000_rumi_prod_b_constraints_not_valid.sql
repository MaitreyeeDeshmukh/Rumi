-- Rumi production migration B of E: NEW CONSTRAINTS, NOT VALID. One transaction, short locks.
--
-- ADD CONSTRAINT ... NOT VALID checks only rows written from now on and does not scan the table, so the lock is
-- brief; if the table is busy the statement gives up after 3 s instead of queueing in front of the traffic.
-- Old rows are checked by file C (VALIDATE CONSTRAINT does not block writes).
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- Guard: the persona shape rule must already hold for every existing row. The retired kind focus_pref (Supermemory
-- era) is the expected offender. This file NEVER deletes data: it stops and tells the operator what to do.
do $$
declare v_bad bigint; v_focus bigint;
begin
  select count(*), count(*) filter (where kind = 'focus_pref') into v_bad, v_focus
  from public.persona_facts
  where not ((kind = 'support_pref' and key ~ '^p[1-6]$' and level is null)
          or (kind = 'pacing' and key in ('one_question', 'extra_time') and level is null)
          or (kind = 'help_level' and key in ('concern', 'question', 'accommodation') and level is not null));
  if v_bad > 0 then
    raise exception 'persona_facts has % row(s) outside the allowed shape (% of them with the retired kind focus_pref). Nothing was changed. Look at them, then remove them on purpose (for the retired kind only: delete from public.persona_facts where kind = ''focus_pref'';) and apply this file again.', v_bad, v_focus
      using errcode = 'P0001';
  end if;
end $$;

do $$
declare c record;
begin
  for c in select * from (values
    ('public.ops_ai_events', 'ops_ai_events_outcome_v2_check',
     $d$check (outcome in ('ok', 'degraded', 'crisis', 'rate_limited', 'invalid_input', 'provider_error',
                           'guard_blocked', 'unauthorized', 'timeout', 'config_error'))$d$),
    ('public.ops_ai_events', 'ops_ai_events_cache_status_check', $d$check (cache_status in ('miss', 'hit', 'bypass'))$d$),
    ('public.ops_ai_events', 'ops_ai_events_cached_tokens_check', $d$check (cached_tokens >= 0)$d$),
    -- the shape the sink sends (lib/telemetry/sinks.ts BUCKET): lowercase letters, digits, : _ -
    ('public.ops_ai_events', 'ops_ai_events_bucket_shape_check', $d$check (bucket ~ '^[a-z0-9:_-]{1,40}$')$d$),
    -- the facts Rumi can make (features/shared/constants.ts, support/presets.ts): 3 kinds with fixed keys
    ('public.persona_facts', 'persona_facts_shape_check',
     $d$check ((kind = 'support_pref' and key ~ '^p[1-6]$' and level is null)
            or (kind = 'pacing' and key in ('one_question', 'extra_time') and level is null)
            or (kind = 'help_level' and key in ('concern', 'question', 'accommodation') and level is not null))$d$),
    -- the buckets lib/ai/limits.ts sends: global, u:/ip: with a lowercase hex hash, optional c: prefix (crisis classifier)
    ('public.ops_ai_usage_daily', 'ops_ai_usage_daily_bucket_v2_check',
     $d$check (bucket ~ '^(global|(c:)?(u|ip):[0-9a-f]{8,32})$')$d$)
  ) as v(tbl, name, def)
  loop
    if not exists (select 1 from pg_constraint where conname = c.name and conrelid = c.tbl::regclass) then
      execute format('alter table %s add constraint %I %s not valid', c.tbl, c.name, c.def);
    end if;
  end loop;
end $$;
