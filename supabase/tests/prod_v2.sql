-- Production v2 tests (flags, app events, persona functions, self-heal, export, sign-up trigger,
-- role timeouts, maintenance job, RLS regression guards).
--   bash scripts/db/run-sql.sh supabase/tests/prod_v2.sql
-- LOCAL stack only. One transaction, always rolled back. Any broken rule raises "FAIL: ...".
begin;

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b');

-- =============================================================================================
-- 1. Ops tables are service_role only
-- =============================================================================================
do $$ begin
  if (select count(*) from public.ops_feature_flags where enabled) <> 3 then
    raise exception 'FAIL: expected 3 seeded flags, all enabled'; end if;
  if (select count(*) from public.ops_feature_flags where key in ('ai_enabled','memory_sync_enabled','cloud_sync_enabled')) <> 3 then
    raise exception 'FAIL: wrong flag keys'; end if;
  begin insert into public.ops_feature_flags (key, enabled) values ('Bad Key', true);
    raise exception 'FAIL: bad flag key accepted'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code) values ('mobile', 'app', 'x');
    raise exception 'FAIL: bad source accepted'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code) values ('server', 'nope', 'x');
    raise exception 'FAIL: bad area accepted'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code) values ('server', 'app', 'Has Space');
    raise exception 'FAIL: bad code accepted'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code) values ('server', 'app', repeat('a', 61));
    raise exception 'FAIL: 61 char code accepted'; exception when check_violation then null; end;
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$ begin
  begin perform 1 from public.ops_feature_flags; raise exception 'FAIL: user read flags';
    exception when insufficient_privilege then null; end;
  begin update public.ops_feature_flags set enabled = false; raise exception 'FAIL: user wrote flags';
    exception when insufficient_privilege then null; end;
  begin perform 1 from public.ops_app_events; raise exception 'FAIL: user read app events';
    exception when insufficient_privilege then null; end;
  begin insert into public.ops_app_events (source, area, code) values ('client', 'app', 'x');
    raise exception 'FAIL: user wrote app events'; exception when insufficient_privilege then null; end;
  begin perform public.ops_log_app_event('client', 'app', 'x', null, null, null, null::smallint);
    raise exception 'FAIL: user called ops_log_app_event'; exception when insufficient_privilege then null; end;
  begin perform public.ops_maintenance_daily();
    raise exception 'FAIL: user called ops_maintenance_daily'; exception when insufficient_privilege then null; end;
  begin perform public.ops_create_app_event_partition('2030-01-01');
    raise exception 'FAIL: user created a partition'; exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.ops_feature_flags; raise exception 'FAIL: anon read flags';
    exception when insufficient_privilege then null; end;
  begin perform 1 from public.ops_app_events; raise exception 'FAIL: anon read app events';
    exception when insufficient_privilege then null; end;
  begin perform public.persona_upsert_facts('[]'); raise exception 'FAIL: anon called persona_upsert_facts';
    exception when insufficient_privilege then null; end;
  begin perform public.core_export_my_data(); raise exception 'FAIL: anon called core_export_my_data';
    exception when insufficient_privilege then null; end;
  begin perform public.core_ensure_my_rows(); raise exception 'FAIL: anon called core_ensure_my_rows';
    exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
do $$ begin
  perform public.ops_log_app_event('server', 'ai', 'groq_5xx', 'abc123', '/api/plan', 'r1', 502::smallint);
  if (select count(*) from public.ops_app_events where code = 'groq_5xx' and status = 502) <> 1 then
    raise exception 'FAIL: ops_log_app_event did not store the row'; end if;
  update public.ops_feature_flags set enabled = false where key = 'ai_enabled';
  if (select enabled from public.ops_feature_flags where key = 'ai_enabled') then
    raise exception 'FAIL: service_role could not flip a flag'; end if;
  if (select updated_at from public.ops_feature_flags where key = 'ai_enabled') < now() - interval '1 minute' then
    raise exception 'FAIL: flag updated_at not touched'; end if;
end $$;

-- =============================================================================================
-- 2. ops_ai_events: new outcomes and cache columns, old check validated and replaced
-- =============================================================================================
do $$ declare o text; begin
  foreach o in array array['ok','degraded','crisis','rate_limited','invalid_input','provider_error','guard_blocked','unauthorized','timeout','config_error'] loop
    insert into public.ops_ai_events (task, outcome, cache_status, cached_tokens) values ('plan', o, 'hit', 12);
  end loop;
  begin insert into public.ops_ai_events (task, outcome) values ('plan', 'mock');
    raise exception 'FAIL: outcome mock accepted'; exception when check_violation then null; end;
  begin insert into public.ops_ai_events (task, outcome, cache_status) values ('plan', 'ok', 'warm');
    raise exception 'FAIL: bad cache_status accepted'; exception when check_violation then null; end;
  begin insert into public.ops_ai_events (task, outcome, cached_tokens) values ('plan', 'ok', -1);
    raise exception 'FAIL: negative cached_tokens accepted'; exception when check_violation then null; end;
  if exists (select 1 from pg_constraint where conrelid = 'public.ops_ai_events'::regclass and not convalidated) then
    raise exception 'FAIL: a constraint on ops_ai_events is still NOT VALID'; end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.ops_ai_events'::regclass and conname = 'ops_ai_events_outcome_check') then
    raise exception 'FAIL: superseded outcome check still present'; end if;
end $$;

-- =============================================================================================
-- 3. persona_upsert_facts / persona_forget_all
-- =============================================================================================
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$ begin
  -- consent gate (RLS): no persona_memory consent, no write
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"slow"}]');
    raise exception 'FAIL: persona write allowed without consent'; exception when insufficient_privilege then null; end;
end $$;

insert into public.core_consents (kind, granted, policy_version, granted_at) values ('persona_memory', true, 'v1', now());

do $$ declare n integer; lvl smallint; begin
  -- first write
  n := public.persona_upsert_facts('[
    {"kind":"support_pref","key":"quiet_room","client_updated_at":"2026-01-01T00:00:00Z"},
    {"kind":"pacing","key":"slow","client_updated_at":"2026-01-01T00:00:00Z"},
    {"kind":"help_level","key":"questions","level":1,"client_updated_at":"2026-01-01T00:00:00Z"}]');
  if n <> 3 then raise exception 'FAIL: first upsert wrote % rows, expected 3', n; end if;
  -- idempotent: same batch again changes nothing
  n := public.persona_upsert_facts('[
    {"kind":"support_pref","key":"quiet_room","client_updated_at":"2026-01-01T00:00:00Z"},
    {"kind":"pacing","key":"slow","client_updated_at":"2026-01-01T00:00:00Z"},
    {"kind":"help_level","key":"questions","level":1,"client_updated_at":"2026-01-01T00:00:00Z"}]');
  if n <> 0 then raise exception 'FAIL: replay wrote % rows, expected 0', n; end if;
  -- newer device wins
  n := public.persona_upsert_facts('[{"kind":"help_level","key":"questions","level":3,"client_updated_at":"2026-02-01T00:00:00Z"}]');
  select level into lvl from public.persona_facts where key = 'questions';
  if n <> 1 or lvl <> 3 then raise exception 'FAIL: newer write did not win (n=%, level=%)', n, lvl; end if;
  -- stale device does not overwrite
  n := public.persona_upsert_facts('[{"kind":"help_level","key":"questions","level":0,"client_updated_at":"2026-01-15T00:00:00Z"}]');
  select level into lvl from public.persona_facts where key = 'questions';
  if n <> 0 or lvl <> 3 then raise exception 'FAIL: stale write overwrote (n=%, level=%)', n, lvl; end if;
  -- same key twice in one batch: no error, newest wins
  n := public.persona_upsert_facts('[
    {"kind":"help_level","key":"dup","level":1,"client_updated_at":"2026-03-01T00:00:00Z"},
    {"kind":"help_level","key":"dup","level":2,"client_updated_at":"2026-03-02T00:00:00Z"}]');
  select level into lvl from public.persona_facts where key = 'dup';
  if n <> 1 or lvl <> 2 then raise exception 'FAIL: duplicate key in batch (n=%, level=%)', n, lvl; end if;
  -- empty batch is fine
  if public.persona_upsert_facts('[]') <> 0 then raise exception 'FAIL: empty batch wrote rows'; end if;
  -- cap: 100 ok, 101 rejected
  n := public.persona_upsert_facts((select jsonb_agg(jsonb_build_object('kind','support_pref','key','k'||g)) from generate_series(1,100) g));
  if n <> 100 then raise exception 'FAIL: 100-element batch wrote % rows', n; end if;
  begin perform public.persona_upsert_facts((select jsonb_agg(jsonb_build_object('kind','support_pref','key','j'||g)) from generate_series(1,101) g));
    raise exception 'FAIL: 101 elements accepted'; exception when program_limit_exceeded then null; end;
  if (select count(*) from public.persona_facts where key like 'j%') <> 0 then
    raise exception 'FAIL: rejected batch left rows'; end if;
  -- bad kinds and shapes
  begin perform public.persona_upsert_facts('[{"kind":"focus_pref","key":"x"}]');
    raise exception 'FAIL: focus_pref accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"made_up","key":"x"}]');
    raise exception 'FAIL: unknown kind accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"Has Space And Caps"}]');
    raise exception 'FAIL: bad key accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"help_level","key":"nolevel"}]');
    raise exception 'FAIL: help_level without level accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('{"kind":"pacing","key":"x"}');
    raise exception 'FAIL: non-array accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.persona_upsert_facts(null);
    raise exception 'FAIL: null accepted'; exception when invalid_parameter_value then null; end;
  -- client_updated_at defaults to now() when omitted
  perform public.persona_upsert_facts('[{"kind":"pacing","key":"nots"}]');
  if (select client_updated_at from public.persona_facts where key = 'nots') < now() - interval '1 minute' then
    raise exception 'FAIL: default client_updated_at wrong'; end if;
end $$;

-- consent revoked mid-sync: writes stop, erase still works
update public.core_consents set granted = false where kind = 'persona_memory';
do $$ begin
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"after_revoke"}]');
    raise exception 'FAIL: insert allowed after consent revoked'; exception when insufficient_privilege then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"help_level","key":"questions","level":0,"client_updated_at":"2030-01-01T00:00:00Z"}]');
    raise exception 'FAIL: update allowed after consent revoked'; exception when insufficient_privilege then null; end;
end $$;

-- B sees none of A's facts and cannot erase them
reset role;
set local "request.jwt.claims" = '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}';
set local role authenticated;
do $$ begin
  if (select count(*) from public.persona_facts) <> 0 then raise exception 'FAIL: B reads A facts'; end if;
  if public.persona_forget_all() <> 0 then raise exception 'FAIL: B forget_all returned nonzero'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.persona_facts where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a') < 100 then
    raise exception 'FAIL: B forget_all erased A facts'; end if;
end $$;

-- A erases everything (consent is off: erase must still work)
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
set local role authenticated;
do $$ begin
  if public.persona_forget_all() <> 0 then raise exception 'FAIL: persona_forget_all did not return 0'; end if;
  if (select count(*) from public.persona_facts) <> 0 then raise exception 'FAIL: facts remain after forget_all'; end if;
end $$;
update public.core_consents set granted = true where kind = 'persona_memory';

-- =============================================================================================
-- 4. core_ensure_my_rows heals a user whose rows were deleted
-- =============================================================================================
reset role;
delete from public.core_profiles where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
delete from public.core_settings where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
set local role authenticated;
do $$ begin
  if (select count(*) from public.core_profiles) <> 0 then raise exception 'FAIL: setup, profile still there'; end if;
  perform public.core_ensure_my_rows();
  perform public.core_ensure_my_rows();   -- twice: idempotent
  if (select count(*) from public.core_profiles) <> 1 then raise exception 'FAIL: profile not healed'; end if;
  if (select count(*) from public.core_settings) <> 1 then raise exception 'FAIL: settings not healed'; end if;
  if (select theme from public.core_settings) <> 'soft' then raise exception 'FAIL: healed settings are not defaults'; end if;
end $$;
reset role;
set local "request.jwt.claims" = '{}';
do $$ begin
  begin perform public.core_ensure_my_rows(); raise exception 'FAIL: ensure_my_rows ran without a user (superuser, no jwt)';
  exception when sqlstate '28000' then null; end;
end $$;

-- =============================================================================================
-- 5. core_export_my_data returns only the caller's rows, from every owner table
-- =============================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
insert into public.core_consents (kind, granted, policy_version) values ('cloud_sync', true, 'v1');
insert into public.plan_visit_plans (id, title) values ('11111111-0000-0000-0000-00000000000a', 'A plan');
insert into public.plan_items (plan_id, position, local_id, text, kind, source)
  values ('11111111-0000-0000-0000-00000000000a', 0, 'q1', 'A question', 'question', 'user');
select public.persona_upsert_facts('[{"kind":"pacing","key":"slow"}]');

reset role;
set local "request.jwt.claims" = '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}';
set local role authenticated;
insert into public.core_consents (kind, granted, policy_version) values ('cloud_sync', true, 'v1');
insert into public.plan_visit_plans (id, title) values ('22222222-0000-0000-0000-00000000000b', 'B plan');

reset role;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
set local role authenticated;
do $$ declare e jsonb; k text; own int; total int; begin
  e := public.core_export_my_data();
  if (select count(*) from jsonb_object_keys(e)) <> 17 then
    raise exception 'FAIL: export has % tables, expected 17', (select count(*) from jsonb_object_keys(e)); end if;
  for k in select jsonb_object_keys(e) loop
    select count(*) into total from jsonb_array_elements(e -> k);
    select count(*) into own from jsonb_array_elements(e -> k) r where r ->> 'owner_id' = 'aaaaaaaa-0000-0000-0000-00000000000a';
    if total <> own then raise exception 'FAIL: export of % has rows of other users', k; end if;
  end loop;
  if jsonb_array_length(e -> 'plan_visit_plans') <> 1 or e -> 'plan_visit_plans' -> 0 ->> 'title' <> 'A plan' then
    raise exception 'FAIL: export plan wrong'; end if;
  if jsonb_array_length(e -> 'plan_items') <> 1 or jsonb_array_length(e -> 'persona_facts') <> 1 then
    raise exception 'FAIL: export children wrong'; end if;
  if e::text like '%bbbbbbbb-0000%' or e::text like '%B plan%' then raise exception 'FAIL: export leaks B data'; end if;
end $$;

-- =============================================================================================
-- 6. Sign-up trigger failure does NOT block sign-up
-- =============================================================================================
reset role;
alter table public.core_profiles add constraint tmp_block_insert check (false) not valid;   -- every new profile row now fails
insert into auth.users (id) values ('cccccccc-0000-0000-0000-00000000000c');
do $$ begin
  if not exists (select 1 from auth.users where id = 'cccccccc-0000-0000-0000-00000000000c') then
    raise exception 'FAIL: trigger failure blocked the sign-up'; end if;
  if exists (select 1 from public.core_profiles where owner_id = 'cccccccc-0000-0000-0000-00000000000c') then
    raise exception 'FAIL: setup, profile was created despite the blocking constraint'; end if;
  if (select count(*) from public.ops_app_events where area = 'auth' and code = 'signup_trigger_failed' and fingerprint = '23514') <> 1 then
    raise exception 'FAIL: trigger failure not logged'; end if;
end $$;
-- even if logging itself fails, sign-up still works
alter table public.ops_app_events add constraint tmp_block_insert check (false) not valid;
insert into auth.users (id) values ('dddddddd-0000-0000-0000-00000000000d');
do $$ begin
  if not exists (select 1 from auth.users where id = 'dddddddd-0000-0000-0000-00000000000d') then
    raise exception 'FAIL: logging failure blocked the sign-up'; end if;
end $$;
alter table public.core_profiles drop constraint tmp_block_insert;
alter table public.ops_app_events drop constraint tmp_block_insert;
-- the user heals themselves
set local "request.jwt.claims" = '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}';
set local role authenticated;
select public.core_ensure_my_rows();
do $$ begin
  if (select count(*) from public.core_profiles) <> 1 or (select count(*) from public.core_settings) <> 1 then
    raise exception 'FAIL: user did not heal after trigger failure'; end if;
end $$;
reset role;

-- =============================================================================================
-- 7. Role timeouts are configured
-- =============================================================================================
do $$ declare r text; s text; begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach s in array array['statement_timeout=8s', 'idle_in_transaction_session_timeout=30s', 'lock_timeout=5s'] loop
      if not exists (
        select 1 from pg_db_role_setting d join pg_roles ro on ro.oid = d.setrole
        where ro.rolname = r and d.setdatabase = 0 and s = any (d.setconfig)) then
        raise exception 'FAIL: role % is missing %', r, s; end if;
    end loop;
  end loop;
end $$;

-- =============================================================================================
-- 8. ops_maintenance_daily: partitions, retention, anonymous-user purge, isolation, schedule
-- =============================================================================================
do $$ begin
  if (select count(*) from cron.job where jobname = 'rumi-ops-maintenance-daily' and schedule = '17 3 * * *'
        and command = 'select public.ops_maintenance_daily()') <> 1 then
    raise exception 'FAIL: pg_cron job missing or wrong schedule'; end if;
end $$;

-- setup: users
insert into auth.users (id, is_anonymous, created_at, last_sign_in_at) values
  ('a0000000-0000-0000-0000-000000000001', true,  now() - interval '100 days', null),                      -- purge
  ('a0000000-0000-0000-0000-000000000002', true,  now() - interval '61 days',  null),                      -- purge
  ('a0000000-0000-0000-0000-000000000003', true,  now() - interval '200 days', now() - interval '5 days'), -- keep: active
  ('a0000000-0000-0000-0000-000000000004', true,  now() - interval '59 days',  null),                      -- keep: recent
  ('a0000000-0000-0000-0000-000000000005', true,  now(),                       null),                      -- keep: new
  ('a0000000-0000-0000-0000-000000000006', false, now() - interval '200 days', null);                      -- keep: not anonymous
-- the purged user owns content: it must cascade away
insert into public.core_consents (owner_id, kind, granted, policy_version) values ('a0000000-0000-0000-0000-000000000001', 'cloud_sync', true, 'v1');
insert into public.plan_visit_plans (owner_id, title) values ('a0000000-0000-0000-0000-000000000001', 'old anon plan');
insert into public.core_consents (owner_id, kind, granted, policy_version) values ('a0000000-0000-0000-0000-000000000003', 'cloud_sync', true, 'v1');
insert into public.plan_visit_plans (owner_id, title) values ('a0000000-0000-0000-0000-000000000003', 'active anon plan');

-- setup: an old partition (4 months back), a recent one (1 month back) and a missing next month
do $$ declare v_old date := (date_trunc('month', now()) - interval '4 months')::date;
              v_recent date := (date_trunc('month', now()) - interval '1 month')::date;
              v_next date := (date_trunc('month', now()) + interval '1 month')::date; begin
  perform public.ops_create_ai_event_partition(v_old);
  perform public.ops_create_app_event_partition(v_old);
  perform public.ops_create_ai_event_partition(v_recent);
  perform public.ops_create_app_event_partition(v_recent);
  insert into public.ops_ai_events (created_at, task, outcome) values (v_old + 3, 'plan', 'ok');
  insert into public.ops_app_events (created_at, source, area, code) values (v_old + 3, 'server', 'app', 'old_event');
  if to_regclass('public.ops_ai_events_' || to_char(v_old, 'YYYY_MM')) is null then raise exception 'FAIL: setup, old partition missing'; end if;
  -- next month's partitions do not exist (cron outage): inserts must still succeed (default partition)
  execute format('drop table public.ops_ai_events_%s', to_char(v_next, 'YYYY_MM'));
  execute format('drop table public.ops_app_events_%s', to_char(v_next, 'YYYY_MM'));
  insert into public.ops_ai_events (created_at, task, outcome) values (v_next + 2, 'plan', 'ok');
  insert into public.ops_app_events (created_at, source, area, code) values (v_next + 2, 'server', 'app', 'next_event');
  if (select count(*) from public.ops_ai_events_default) <> 1 or (select count(*) from public.ops_app_events_default) <> 1 then
    raise exception 'FAIL: setup, rows did not land in the default partitions'; end if;
end $$;

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select public.ops_maintenance_daily() as maintenance_summary;
reset role;

do $$ declare
  v_old date := (date_trunc('month', now()) - interval '4 months')::date;
  v_recent date := (date_trunc('month', now()) - interval '1 month')::date;
  v_next date := (date_trunc('month', now()) + interval '1 month')::date;
  i int; m date;
begin
  -- partitions for this month and the next two exist, for both tables
  for i in 0..2 loop
    m := (date_trunc('month', now()) + make_interval(months => i))::date;
    if to_regclass('public.ops_ai_events_' || to_char(m, 'YYYY_MM')) is null then raise exception 'FAIL: ai partition % missing', m; end if;
    if to_regclass('public.ops_app_events_' || to_char(m, 'YYYY_MM')) is null then raise exception 'FAIL: app partition % missing', m; end if;
  end loop;
  -- the rows that landed in default were moved, default is empty again, nothing was lost
  if (select count(*) from public.ops_ai_events_default) <> 0 or (select count(*) from public.ops_app_events_default) <> 0 then
    raise exception 'FAIL: default partition still holds rows'; end if;
  execute format('select count(*) from public.ops_ai_events_%s', to_char(v_next, 'YYYY_MM')) into i;
  if i <> 1 then raise exception 'FAIL: ai event lost while repairing partition (%)', i; end if;
  execute format('select count(*) from public.ops_app_events_%s where code = ''next_event''', to_char(v_next, 'YYYY_MM')) into i;
  if i <> 1 then raise exception 'FAIL: app event lost while repairing partition (%)', i; end if;
  -- retention: the 4-month-old partitions are gone with their rows, the 1-month-old ones stay
  if to_regclass('public.ops_ai_events_' || to_char(v_old, 'YYYY_MM')) is not null then raise exception 'FAIL: old ai partition kept'; end if;
  if to_regclass('public.ops_app_events_' || to_char(v_old, 'YYYY_MM')) is not null then raise exception 'FAIL: old app partition kept'; end if;
  if to_regclass('public.ops_ai_events_' || to_char(v_recent, 'YYYY_MM')) is null then raise exception 'FAIL: recent ai partition dropped'; end if;
  if to_regclass('public.ops_app_events_' || to_char(v_recent, 'YYYY_MM')) is null then raise exception 'FAIL: recent app partition dropped'; end if;
  if exists (select 1 from public.ops_app_events where code = 'old_event') then raise exception 'FAIL: old event survived'; end if;
  -- the parent tables are still partitioned, new partitions are locked down
  if not exists (select 1 from pg_class where oid = ('public.ops_app_events_' || to_char(v_next, 'YYYY_MM'))::regclass and relrowsecurity) then
    raise exception 'FAIL: new partition has no RLS'; end if;
  if has_table_privilege('authenticated', ('public.ops_app_events_' || to_char(v_next, 'YYYY_MM'))::regclass, 'select') then
    raise exception 'FAIL: authenticated can read a new partition'; end if;
  -- anonymous-user purge
  if exists (select 1 from auth.users where id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002')) then
    raise exception 'FAIL: old anonymous users not purged'; end if;
  if (select count(*) from auth.users where id in (
        'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006')) <> 4 then
    raise exception 'FAIL: purge removed a recent, active or non-anonymous user'; end if;
  if exists (select 1 from public.plan_visit_plans where title = 'old anon plan') then raise exception 'FAIL: purged user content remains'; end if;
  if exists (select 1 from public.core_profiles where owner_id = 'a0000000-0000-0000-0000-000000000001') then raise exception 'FAIL: purged user profile remains'; end if;
  if not exists (select 1 from public.plan_visit_plans where title = 'active anon plan') then raise exception 'FAIL: active anonymous user content was purged'; end if;
  if exists (select 1 from public.ops_app_events where code in ('maintenance_failed', 'default_partition_rows')) then
    raise exception 'FAIL: clean maintenance run logged a failure'; end if;
end $$;

-- a failing step is recorded and the other steps still run (isolation)
insert into auth.users (id, is_anonymous, created_at) values ('a0000000-0000-0000-0000-000000000007', true, now() - interval '90 days');
create function public.tmp_block_user_delete() returns trigger language plpgsql as $$ begin raise exception 'blocked'; end $$;
create trigger tmp_block_user_delete before delete on auth.users for each row execute function public.tmp_block_user_delete();
do $$ declare v_next2 date := (date_trunc('month', now()) + interval '2 months')::date; begin
  execute format('drop table public.ops_app_events_%s', to_char(v_next2, 'YYYY_MM'));   -- a step before the failing one has work to do
end $$;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select public.ops_maintenance_daily() as maintenance_with_failing_purge;
reset role;
do $$ begin
  if (select count(*) from public.ops_app_events where code = 'maintenance_failed' and fingerprint = 'anon_purge:P0001') <> 1 then
    raise exception 'FAIL: failing purge not recorded'; end if;
  if to_regclass('public.ops_app_events_' || to_char((date_trunc('month', now()) + interval '2 months')::date, 'YYYY_MM')) is null then
    raise exception 'FAIL: partition step did not run before the failing purge'; end if;
  if not exists (select 1 from auth.users where id = 'a0000000-0000-0000-0000-000000000007') then
    raise exception 'FAIL: failing purge still deleted the user'; end if;
end $$;
drop trigger tmp_block_user_delete on auth.users;
drop function public.tmp_block_user_delete();

-- =============================================================================================
-- 9. RLS regression guards (apply to every table and function, present and future)
-- =============================================================================================
do $$ declare bad text; begin
  -- every ordinary or partitioned table in public has RLS on
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then raise exception 'FAIL: RLS is off on: %', bad; end if;

  -- ops_ and research_ tables (and all their partitions) have no policy and no access for users
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and (c.relname like 'ops\_%' or c.relname like 'research\_%')
    and (exists (select 1 from pg_policy p where p.polrelid = c.oid)
         or has_table_privilege('anon', c.oid, 'select,insert,update,delete')
         or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'));
  if bad is not null then raise exception 'FAIL: server-only table reachable by users: %', bad; end if;

  -- anon touches nothing in public
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('anon', c.oid, 'select,insert,update,delete');
  if bad is not null then raise exception 'FAIL: anon has table privileges on: %', bad; end if;

  -- every function of ours pins search_path
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%');
  if bad is not null then raise exception 'FAIL: functions without search_path: %', bad; end if;

  -- no ops function is executable by users
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'ops\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then raise exception 'FAIL: ops functions executable by users: %', bad; end if;

  -- anon may execute no function of ours at all (Rumi has no signed-out API surface)
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'FAIL: functions executable by anon: %', bad; end if;
  if has_schema_privilege('anon', 'private', 'usage') then raise exception 'FAIL: anon can use schema private'; end if;

  -- security definer functions are not executable by anon (kept as a separate, narrower message)
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'FAIL: security definer functions executable by anon: %', bad; end if;

  -- the persona/core user functions run as the caller
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('persona_upsert_facts', 'persona_forget_all', 'core_ensure_my_rows', 'core_export_my_data', 'core_delete_my_data')
               and p.prosecdef) then
    raise exception 'FAIL: a user function is security definer'; end if;
end $$;

select 'ALL PROD V2 TESTS PASSED' as result;
rollback;
