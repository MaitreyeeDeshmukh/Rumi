-- Production tests (flags, app events, persona functions, self-heal, export, sign-up trigger, role timeouts,
-- maintenance steps, RLS and privilege guards).
--   bash scripts/db/run-sql.sh supabase/tests/prod_v2.sql
-- LOCAL stack only. One transaction, always rolled back. Any broken rule raises "FAIL: ...".
begin;

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b');

-- =============================================================================================
-- 1. Ops tables are service_role only; event formats match what the app's sinks send
-- =============================================================================================
do $$ begin
  if (select count(*) from public.ops_feature_flags where enabled) <> 2 then
    raise exception 'FAIL: expected 2 enabled flags (ai, memory_sync; cloud_sync and anon_purge seed off)'; end if;
  if (select count(*) from public.ops_feature_flags where key in ('ai_enabled','memory_sync_enabled','cloud_sync_enabled')) <> 3 then
    raise exception 'FAIL: wrong flag keys'; end if;
  if (select enabled from public.ops_feature_flags where key = 'anon_purge_enabled') is distinct from false then
    raise exception 'FAIL: anon_purge_enabled must be seeded FALSE'; end if;
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
  begin insert into public.ops_app_events (source, area, code, route) values ('server', 'app', 'x', 'http://evil.example/x?token=1');
    raise exception 'FAIL: URL accepted as route'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code, route) values ('server', 'app', 'x', '/' || repeat('a', 80));
    raise exception 'FAIL: 81 char route accepted'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code, fingerprint) values ('server', 'app', 'x', 'has space');
    raise exception 'FAIL: fingerprint with a space accepted'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code, fingerprint) values ('server', 'app', 'x', repeat('a', 65));
    raise exception 'FAIL: 65 char fingerprint accepted'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code, release) values ('server', 'app', 'x', 'bad release!');
    raise exception 'FAIL: bad release accepted'; exception when check_violation then null; end;
  begin insert into public.ops_app_events (source, area, code, status) values ('server', 'app', 'x', 99::smallint);
    raise exception 'FAIL: status 99 accepted'; exception when check_violation then null; end;
  -- values the real sinks produce (lib/telemetry/sinks.ts, errors.ts, config.ts) are accepted
  insert into public.ops_app_events (source, area, code, fingerprint, route, release, status) values
    ('client', 'app', 'render_error', 'AbC123dEf4567890', '/(app)/plan/[id]', 'dev', null),
    ('server', 'ai', 'groq_5xx', '3fa94c01b2d87e65', '/api/plan', 'a1b2c3d4e5f6', 502),
    ('client', 'app', 'global_error', null, 'unknown', null, null),
    ('db', 'db', 'sample_db_event', 'partitions:42501', null, null, null);
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
  begin perform public.ops_log_app_event('client', 'app', 'x');
    raise exception 'FAIL: user called ops_log_app_event'; exception when insufficient_privilege then null; end;
  begin perform public.ops_maintenance_daily();
    raise exception 'FAIL: user called ops_maintenance_daily'; exception when insufficient_privilege then null; end;
  begin perform public.ops_maint_anon_purge();
    raise exception 'FAIL: user called ops_maint_anon_purge'; exception when insufficient_privilege then null; end;
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
  if (select count(*) from public.ops_app_events where code = 'groq_5xx' and fingerprint = 'abc123' and status = 502) <> 1 then
    raise exception 'FAIL: ops_log_app_event did not store the row'; end if;
  perform public.ops_log_app_event('server', 'app', 'only_three_args');   -- the optional arguments default to null
  if (select count(*) from public.ops_app_events where code = 'only_three_args' and route is null and status is null) <> 1 then
    raise exception 'FAIL: ops_log_app_event with 3 arguments'; end if;
  update public.ops_feature_flags set enabled = false where key = 'ai_enabled';
  if (select enabled from public.ops_feature_flags where key = 'ai_enabled') then
    raise exception 'FAIL: service_role could not flip a flag'; end if;
  if (select updated_at from public.ops_feature_flags where key = 'ai_enabled') < now() - interval '1 minute' then
    raise exception 'FAIL: flag updated_at not touched'; end if;
  -- partition creation needs rights service_role does not have: it must not look callable
  begin perform public.ops_create_app_event_partition('2030-01-01');
    raise exception 'FAIL: service_role can call the partition function'; exception when insufficient_privilege then null; end;
  begin perform public.ops_prune_ai_usage(0);
    raise exception 'FAIL: ops_prune_ai_usage(0) accepted'; exception when invalid_parameter_value then null; end;
end $$;

-- =============================================================================================
-- 2. ops_ai_events / ops_ai_usage_daily constraints: new rules in force, old ones gone, nothing left NOT VALID
-- =============================================================================================
do $$ declare o text; begin
  foreach o in array array['ok','degraded','crisis','rate_limited','invalid_input','provider_error','guard_blocked','unauthorized','timeout','config_error'] loop
    insert into public.ops_ai_events (task, outcome, cache_status, cached_tokens, bucket) values ('plan', o, 'hit', 12, 'u:0123456789abcdef');
  end loop;
  begin insert into public.ops_ai_events (task, outcome) values ('plan', 'mock');
    raise exception 'FAIL: outcome mock accepted'; exception when check_violation then null; end;
  begin insert into public.ops_ai_events (task, outcome, cache_status) values ('plan', 'ok', 'warm');
    raise exception 'FAIL: bad cache_status accepted'; exception when check_violation then null; end;
  begin insert into public.ops_ai_events (task, outcome, cached_tokens) values ('plan', 'ok', -1);
    raise exception 'FAIL: negative cached_tokens accepted'; exception when check_violation then null; end;
  begin insert into public.ops_ai_events (task, outcome, bucket) values ('plan', 'ok', 'Bad Bucket!');
    raise exception 'FAIL: bad event bucket accepted'; exception when check_violation then null; end;
  begin perform public.ops_bump_ai_usage('u:q', 1, 0);
    raise exception 'FAIL: bad usage bucket accepted'; exception when check_violation then null; end;
  perform public.ops_bump_ai_usage('global', 1, 0);
  perform public.ops_bump_ai_usage('c:ip:0123abcd', 1, 0);
  if exists (select 1 from pg_constraint where conrelid in ('public.ops_ai_events'::regclass, 'public.persona_facts'::regclass, 'public.ops_ai_usage_daily'::regclass) and not convalidated) then
    raise exception 'FAIL: a constraint is still NOT VALID'; end if;
  if exists (select 1 from pg_constraint where conname in ('ops_ai_events_outcome_check', 'persona_facts_kind_check', 'ops_ai_usage_daily_bucket_check')) then
    raise exception 'FAIL: a superseded constraint is still present'; end if;
end $$;

-- =============================================================================================
-- 3. persona_upsert_facts / persona_forget_all (keys are the real presets: p1-p6, one_question/extra_time, concern/question/accommodation)
-- =============================================================================================
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$ begin
  -- consent gate (RLS): no persona_memory consent, no write
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"extra_time"}]');
    raise exception 'FAIL: persona write allowed without consent'; exception when insufficient_privilege then null; end;
end $$;

insert into public.core_consents (kind, granted, policy_version, granted_at) values ('persona_memory', true, 'v1', now());

do $$ declare n integer; lvl smallint; before_n integer; begin
  -- first write
  n := public.persona_upsert_facts('[
    {"kind":"support_pref","key":"p1","client_updated_at":"2026-01-01T00:00:00Z"},
    {"kind":"pacing","key":"one_question","client_updated_at":"2026-01-01T00:00:00Z"},
    {"kind":"help_level","key":"question","level":1,"client_updated_at":"2026-01-01T00:00:00Z"}]');
  if n <> 3 then raise exception 'FAIL: first upsert wrote % rows, expected 3', n; end if;
  -- idempotent: same batch again changes nothing
  n := public.persona_upsert_facts('[
    {"kind":"support_pref","key":"p1","client_updated_at":"2026-01-01T00:00:00Z"},
    {"kind":"pacing","key":"one_question","client_updated_at":"2026-01-01T00:00:00Z"},
    {"kind":"help_level","key":"question","level":1,"client_updated_at":"2026-01-01T00:00:00Z"}]');
  if n <> 0 then raise exception 'FAIL: replay wrote % rows, expected 0', n; end if;
  -- newer device wins
  n := public.persona_upsert_facts('[{"kind":"help_level","key":"question","level":3,"client_updated_at":"2026-02-01T00:00:00Z"}]');
  select level into lvl from public.persona_facts where key = 'question';
  if n <> 1 or lvl <> 3 then raise exception 'FAIL: newer write did not win (n=%, level=%)', n, lvl; end if;
  -- stale device does not overwrite
  n := public.persona_upsert_facts('[{"kind":"help_level","key":"question","level":0,"client_updated_at":"2026-01-15T00:00:00Z"}]');
  select level into lvl from public.persona_facts where key = 'question';
  if n <> 0 or lvl <> 3 then raise exception 'FAIL: stale write overwrote (n=%, level=%)', n, lvl; end if;
  -- same key twice in one batch: no error, newest wins
  n := public.persona_upsert_facts('[
    {"kind":"help_level","key":"concern","level":1,"client_updated_at":"2026-03-01T00:00:00Z"},
    {"kind":"help_level","key":"concern","level":2,"client_updated_at":"2026-03-02T00:00:00Z"}]');
  select level into lvl from public.persona_facts where key = 'concern';
  if n <> 1 or lvl <> 2 then raise exception 'FAIL: duplicate key in batch (n=%, level=%)', n, lvl; end if;
  -- empty batch is fine
  if public.persona_upsert_facts('[]') <> 0 then raise exception 'FAIL: empty batch wrote rows'; end if;
  -- cap of 100 elements: 100 accepted (they collapse to the 6 preset keys), 101 rejected with nothing written
  select count(*) into before_n from public.persona_facts;
  n := public.persona_upsert_facts((select jsonb_agg(jsonb_build_object('kind','support_pref','key','p' || (1 + g % 6), 'client_updated_at', '2026-04-01T00:00:00Z'::timestamptz + g * interval '1 second')) from generate_series(1,100) g));
  if n <> 6 then raise exception 'FAIL: 100-element batch wrote % rows, expected 6 (p1 updated, p2-p6 new)', n; end if;
  begin perform public.persona_upsert_facts((select jsonb_agg(jsonb_build_object('kind','support_pref','key','p1')) from generate_series(1,101) g));
    raise exception 'FAIL: 101 elements accepted'; exception when program_limit_exceeded then null; end;
  if (select count(*) from public.persona_facts) <> before_n + 5 then raise exception 'FAIL: rejected batch changed the table'; end if;
  -- shape rules: kinds, keys and levels the app can make, nothing else
  begin perform public.persona_upsert_facts('[{"kind":"focus_pref","key":"p1"}]');
    raise exception 'FAIL: focus_pref accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"made_up","key":"p1"}]');
    raise exception 'FAIL: unknown kind accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"Has Space And Caps"}]');
    raise exception 'FAIL: bad key accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"support_pref","key":"p7"}]');
    raise exception 'FAIL: unknown preset id accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"p1"}]');
    raise exception 'FAIL: preset id under pacing accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"support_pref","key":"p1","level":2}]');
    raise exception 'FAIL: level on a support_pref accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"help_level","key":"concern"}]');
    raise exception 'FAIL: help_level without level accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"help_level","key":"question","level":4}]');
    raise exception 'FAIL: level 4 accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"help_level","key":"p1","level":1}]');
    raise exception 'FAIL: help_level with a preset key accepted'; exception when check_violation then null; end;
  begin perform public.persona_upsert_facts('{"kind":"pacing","key":"extra_time"}');
    raise exception 'FAIL: non-array accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.persona_upsert_facts(null);
    raise exception 'FAIL: null accepted'; exception when invalid_parameter_value then null; end;
  -- client_updated_at: defaults to now(), must be finite, is clamped to 5 minutes ahead
  perform public.persona_upsert_facts('[{"kind":"pacing","key":"extra_time"}]');
  if (select client_updated_at from public.persona_facts where key = 'extra_time') < now() - interval '1 minute' then
    raise exception 'FAIL: default client_updated_at wrong'; end if;
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"extra_time","client_updated_at":"infinity"}]');
    raise exception 'FAIL: infinity accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"extra_time","client_updated_at":"-infinity"}]');
    raise exception 'FAIL: -infinity accepted'; exception when invalid_parameter_value then null; end;
  perform public.persona_upsert_facts('[{"kind":"pacing","key":"one_question","client_updated_at":"2999-01-01T00:00:00Z"}]');
  if (select client_updated_at from public.persona_facts where key = 'one_question') > now() + interval '6 minutes' then
    raise exception 'FAIL: a far-future client_updated_at was stored as is'; end if;
  if (select client_updated_at from public.persona_facts where key = 'one_question') < now() + interval '4 minutes' then
    raise exception 'FAIL: the clamp is not 5 minutes ahead'; end if;
end $$;

-- consent revoked mid-sync: writes stop, erase still works
update public.core_consents set granted = false where kind = 'persona_memory';
do $$ begin
  begin perform public.persona_upsert_facts('[{"kind":"pacing","key":"extra_time"}]');
    raise exception 'FAIL: write allowed after consent revoked'; exception when insufficient_privilege then null; end;
  begin perform public.persona_upsert_facts('[{"kind":"help_level","key":"question","level":0,"client_updated_at":"2030-01-01T00:00:00Z"}]');
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
  if (select count(*) from public.persona_facts where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a') < 5 then
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

-- ---- 3b. caps. The shape rule limits a person to 11 facts, so the 200 caps are backstops: lift the shape rules inside
--      this transaction to prove they hold.
reset role;
alter table public.persona_facts drop constraint persona_facts_shape_check;
alter table public.persona_removed drop constraint persona_removed_shape_check;
set local role authenticated;
do $$ declare n integer; begin
  n := public.persona_upsert_facts((select jsonb_agg(jsonb_build_object('kind','support_pref','key','k' || g)) from generate_series(1,100) g));
  if n <> 100 then raise exception 'FAIL: setup, wrote % rows', n; end if;
  n := public.persona_upsert_facts((select jsonb_agg(jsonb_build_object('kind','support_pref','key','m' || g)) from generate_series(1,100) g));
  if n <> 100 then raise exception 'FAIL: setup, 200 facts should be allowed (wrote %)', n; end if;
  -- the 201st NEW fact is refused (54000), nothing written
  begin perform public.persona_upsert_facts('[{"kind":"support_pref","key":"one_more"}]');
    raise exception 'FAIL: 201st fact accepted'; exception when program_limit_exceeded then null; end;
  if (select count(*) from public.persona_facts) <> 200 then raise exception 'FAIL: rejected batch wrote rows'; end if;
  -- updating existing facts is still fine at the cap (only NEW facts count)
  n := public.persona_upsert_facts('[{"kind":"support_pref","key":"k1","client_updated_at":"2999-01-01T00:00:00Z"}]');
  if n <> 1 then raise exception 'FAIL: update refused at the cap (%)', n; end if;
end $$;
reset role;
-- 250 facts removed in one statement: the tombstone cap must trim to 200, never block a removal
insert into public.persona_facts (owner_id, kind, key) select 'aaaaaaaa-0000-0000-0000-00000000000a', 'support_pref', 'x' || g from generate_series(1,50) g;
do $$ begin
  if (select count(*) from pg_trigger where tgrelid = 'public.persona_facts'::regclass and tgname = 'persona_facts_tombstone') <> 1 then
    raise exception 'FAIL: tombstone trigger missing (file D)'; end if;
end $$;
delete from public.persona_facts where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
do $$ begin
  if (select count(*) from public.persona_removed where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a') <> 200 then
    raise exception 'FAIL: tombstones should be capped at 200 (got %)', (select count(*) from public.persona_removed where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a'); end if;
  if (select count(*) from public.persona_facts where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a') <> 0 then
    raise exception 'FAIL: removal was refused'; end if;
end $$;
delete from public.persona_removed where owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a';

-- =============================================================================================
-- 4. core_ensure_my_rows heals a user whose rows were deleted
-- =============================================================================================
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
  begin perform public.core_delete_my_data(); raise exception 'FAIL: delete_my_data ran without a user';
  exception when sqlstate '28000' then null; end;
end $$;

-- =============================================================================================
-- 5. core_export_my_data returns only the caller's rows, from every owner table, capped per table
-- =============================================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
insert into public.core_consents (kind, granted, policy_version) values ('cloud_sync', true, 'v1');
insert into public.plan_visit_plans (id, title) values ('11111111-0000-0000-0000-00000000000a', 'A plan');
insert into public.plan_items (plan_id, position, local_id, text, kind, source)
  values ('11111111-0000-0000-0000-00000000000a', 0, 'q1', 'A question', 'question', 'user');
select public.persona_upsert_facts('[{"kind":"pacing","key":"one_question"}]');

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
  if (select count(*) from jsonb_object_keys(e)) <> 19 then
    raise exception 'FAIL: export has % keys, expected 18 tables + _truncated', (select count(*) from jsonb_object_keys(e)); end if;
  if e -> '_truncated' <> '{}'::jsonb then raise exception 'FAIL: _truncated should be empty'; end if;
  -- every table with an owner_id column is exported (catches a new owner table the export forgot)
  if exists (select 1 from information_schema.columns c join information_schema.tables tb using (table_schema, table_name)
             where c.table_schema = 'public' and c.column_name = 'owner_id' and tb.table_type = 'BASE TABLE'
               and not (e ? c.table_name)) then
    raise exception 'FAIL: export misses an owner table: %', (select string_agg(c.table_name, ', ')
      from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'owner_id' and not (e ? c.table_name)); end if;
  for k in select k2 from jsonb_object_keys(e) k2 where k2 not in ('persona_removed', '_truncated') loop
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
-- the 5000 rows per table cap names the table that was cut
reset role;
insert into public.plan_visit_plans (owner_id, title, archived_at)
  select 'aaaaaaaa-0000-0000-0000-00000000000a', 'many ' || g, now() from generate_series(1, 5100) g;
set local role authenticated;
do $$ declare e jsonb; begin
  e := public.core_export_my_data();
  if jsonb_array_length(e -> 'plan_visit_plans') <> 5000 then raise exception 'FAIL: export not capped at 5000 (%)', jsonb_array_length(e -> 'plan_visit_plans'); end if;
  if e -> '_truncated' <> '{"plan_visit_plans": true}'::jsonb then raise exception 'FAIL: _truncated wrong: %', e -> '_truncated'; end if;
  if jsonb_array_length(e -> 'plan_items') <> 1 then raise exception 'FAIL: other tables must not be affected by the cap'; end if;
end $$;
reset role;
delete from public.plan_visit_plans where title like 'many %';

-- =============================================================================================
-- 6. Sign-up trigger failure does NOT block sign-up
-- =============================================================================================
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
-- 7. Role timeouts are configured (anon 3 s, authenticated 8 s)
-- =============================================================================================
do $$ declare r text; s text; begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach s in array array['statement_timeout=' || case r when 'anon' then '3s' else '8s' end, 'idle_in_transaction_session_timeout=30s', 'lock_timeout=5s'] loop
      if not exists (
        select 1 from pg_db_role_setting d join pg_roles ro on ro.oid = d.setrole
        where ro.rolname = r and d.setdatabase = 0 and s = any (d.setconfig)) then
        raise exception 'FAIL: role % is missing %', r, s; end if;
    end loop;
  end loop;
end $$;

-- =============================================================================================
-- 8. Maintenance: five independent steps, each its own cron job
-- =============================================================================================
do $$ declare j text; begin
  foreach j in array array['partitions:17', 'retention:19', 'prune:21', 'anon-purge:23', 'health:25'] loop
    if (select count(*) from cron.job where jobname = 'rumi-maint-' || split_part(j, ':', 1)
          and schedule = split_part(j, ':', 2) || ' 3 * * *'
          and command = 'set statement_timeout = ''10min''; select public.ops_maint_' || replace(split_part(j, ':', 1), '-', '_') || '()'
          and username = 'postgres') <> 1 then
      raise exception 'FAIL: cron job % missing, wrong schedule or command, or not owned by postgres', j; end if;
  end loop;
  if exists (select 1 from cron.job where jobname = 'rumi-ops-maintenance-daily') then raise exception 'FAIL: legacy single job still scheduled'; end if;
  -- the steps are definer functions owned by postgres (they create/drop partitions and delete auth users)
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
        ('ops_maint_partitions', 'ops_maint_retention', 'ops_maint_prune', 'ops_maint_anon_purge', 'ops_maint_health', 'ops_maintenance_daily')
        and p.prosecdef and p.proowner = 'postgres'::regrole) <> 6 then
    raise exception 'FAIL: maintenance functions must be SECURITY DEFINER owned by postgres'; end if;
  -- each step pins its lock timeout; the cron commands (checked above) carry the statement timeout
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'ops\_maint\_%'
             and not exists (select 1 from unnest(p.proconfig) c where c = 'lock_timeout=5s')) then
    raise exception 'FAIL: a maintenance step does not pin its lock_timeout'; end if;
end $$;

-- setup: users. The touch trigger would reset updated_at; switch it off for the setup only.
alter table public.core_settings disable trigger core_settings_touch;
insert into auth.users (id, is_anonymous, created_at, last_sign_in_at) values
  ('a0000000-0000-0000-0000-000000000001', true,  now() - interval '100 days', null),                      -- PURGE
  ('a0000000-0000-0000-0000-000000000002', true,  now() - interval '61 days',  null),                      -- PURGE
  ('a0000000-0000-0000-0000-000000000003', true,  now() - interval '200 days', now() - interval '5 days'), -- keep: signed in recently
  ('a0000000-0000-0000-0000-000000000004', true,  now() - interval '59 days',  null),                      -- keep: young
  ('a0000000-0000-0000-0000-000000000005', true,  now(),                       null),                      -- keep: new
  ('a0000000-0000-0000-0000-000000000006', false, now() - interval '200 days', null),                      -- keep: not anonymous
  ('a0000000-0000-0000-0000-000000000008', true,  now() - interval '100 days', null),                      -- keep: session refreshed 3 days ago
  ('a0000000-0000-0000-0000-000000000009', true,  now() - interval '100 days', null),                      -- keep: settings changed 2 days ago
  ('a0000000-0000-0000-0000-000000000010', true,  now() - interval '100 days', null),                      -- keep: plan changed 5 days ago
  ('a0000000-0000-0000-0000-000000000011', true,  now() - interval '100 days', null),                      -- keep: practice session changed
  ('a0000000-0000-0000-0000-000000000012', true,  now() - interval '100 days', null),                      -- keep: persona fact changed
  ('a0000000-0000-0000-0000-000000000013', true,  now() - interval '100 days', null);                      -- keep: recap created
update public.core_settings set updated_at = case when owner_id = 'a0000000-0000-0000-0000-000000000009' then now() - interval '2 days' else now() - interval '200 days' end
  where owner_id::text like 'a0000000-%';
alter table public.core_settings enable trigger core_settings_touch;
insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at)
  values (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000008', now() - interval '100 days', now() - interval '100 days', now() - interval '3 days');
insert into public.plan_visit_plans (id, owner_id, title, updated_at, created_at) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'old anon plan', now() - interval '100 days', now() - interval '100 days'),
  ('a1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'active anon plan', now() - interval '100 days', now() - interval '100 days'),
  ('a1000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010', 'plan changed recently', now() - interval '5 days', now() - interval '100 days'),
  ('a1000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000011', 'plan with recent practice', now() - interval '100 days', now() - interval '100 days');
insert into public.practice_sessions (owner_id, plan_id, focus, updated_at) values
  ('a0000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000011', 'whole', now() - interval '4 days');
insert into public.persona_facts (owner_id, kind, key, updated_at) values
  ('a0000000-0000-0000-0000-000000000012', 'pacing', 'extra_time', now() - interval '3 days');
insert into public.recap_recaps (owner_id, my_speaker, created_at) values
  ('a0000000-0000-0000-0000-000000000013', 'B', now() - interval '3 days');

-- setup: an old partition (4 months back), a recent one (1 month back), missing next month and missing month +4
do $$ declare v_old date := (date_trunc('month', now()) - interval '4 months')::date;
              v_recent date := (date_trunc('month', now()) - interval '1 month')::date;
              v_next date := (date_trunc('month', now()) + interval '1 month')::date;
              v_far date := (date_trunc('month', now()) + interval '4 months')::date; begin
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
  execute format('drop table if exists public.ops_ai_events_%s', to_char(v_far, 'YYYY_MM'));
  execute format('drop table if exists public.ops_app_events_%s', to_char(v_far, 'YYYY_MM'));
  insert into public.ops_ai_events (created_at, task, outcome) values (v_next + 2, 'plan', 'ok');
  insert into public.ops_app_events (created_at, source, area, code) values (v_next + 2, 'server', 'app', 'next_event');
  if (select count(*) from public.ops_ai_events_default) <> 1 or (select count(*) from public.ops_app_events_default) <> 1 then
    raise exception 'FAIL: setup, rows did not land in the default partitions'; end if;
end $$;
-- a stale tombstone, a recent one, an old and a current usage counter
insert into public.persona_removed (owner_id, kind, key, removed_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'pacing', 'extra_time', now() - interval '31 days'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'pacing', 'one_question', now() - interval '1 day');
insert into public.ops_ai_usage_daily (day, bucket, shard, calls) values
  ((now() at time zone 'utc')::date - 10, 'global', 3, 5);

-- ---- anonymous purge, flag OFF (the default): nothing is deleted, the count is logged
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select public.ops_maint_anon_purge() as purge_dry_run;
reset role;
do $$ begin
  if (select count(*) from auth.users where id::text like 'a0000000-%') <> 12 then raise exception 'FAIL: dry run deleted users'; end if;
  if (select count(*) from public.ops_app_events where code = 'anon_purge_dry_run' and fingerprint = 'would_delete:2') <> 1 then
    raise exception 'FAIL: dry run did not log would_delete:2 (got %)', (select string_agg(fingerprint, ',') from public.ops_app_events where code = 'anon_purge_dry_run'); end if;
  if exists (select 1 from public.ops_app_events where code in ('maintenance_failed')) then raise exception 'FAIL: dry run failed'; end if;
end $$;

-- ---- anonymous purge, flag ON
update public.ops_feature_flags set enabled = true where key = 'anon_purge_enabled';
set local role service_role;
select public.ops_maint_anon_purge() as purge_armed;
select public.ops_maint_partitions() as partitions_step;
select public.ops_maint_retention() as retention_step;
select public.ops_maint_prune() as prune_step;
select public.ops_maint_health() as health_step;
reset role;

do $$ declare
  v_old date := (date_trunc('month', now()) - interval '4 months')::date;
  v_recent date := (date_trunc('month', now()) - interval '1 month')::date;
  v_next date := (date_trunc('month', now()) + interval '1 month')::date;
  i int; m date;
begin
  -- partitions for this month and the four after it exist, for both tables
  for i in 0..4 loop
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
  -- the new partitions are locked down
  if not exists (select 1 from pg_class where oid = ('public.ops_app_events_' || to_char(v_next, 'YYYY_MM'))::regclass and relrowsecurity) then
    raise exception 'FAIL: new partition has no RLS'; end if;
  if has_table_privilege('authenticated', ('public.ops_app_events_' || to_char(v_next, 'YYYY_MM'))::regclass, 'select') then
    raise exception 'FAIL: authenticated can read a new partition'; end if;
  -- anonymous-user purge: only the two with NO activity of any kind
  if exists (select 1 from auth.users where id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002')) then
    raise exception 'FAIL: inactive anonymous users not purged'; end if;
  if (select count(*) from auth.users where id::text like 'a0000000-%') <> 10 then
    raise exception 'FAIL: purge removed an active, recent or non-anonymous user (% left of 10)', (select count(*) from auth.users where id::text like 'a0000000-%'); end if;
  if exists (select 1 from public.plan_visit_plans where title = 'old anon plan') then raise exception 'FAIL: purged user content remains'; end if;
  if exists (select 1 from public.core_profiles where owner_id = 'a0000000-0000-0000-0000-000000000001') then raise exception 'FAIL: purged user profile remains'; end if;
  if not exists (select 1 from public.plan_visit_plans where title = 'active anon plan') then raise exception 'FAIL: active anonymous user content was purged'; end if;
  -- prune: the 31-day tombstone and the 10-day usage row are gone, the recent tombstone stays
  if exists (select 1 from public.persona_removed where key = 'extra_time' and owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a') then raise exception 'FAIL: old tombstone kept'; end if;
  if not exists (select 1 from public.persona_removed where key = 'one_question' and owner_id = 'aaaaaaaa-0000-0000-0000-00000000000a') then raise exception 'FAIL: recent tombstone pruned'; end if;
  if exists (select 1 from public.ops_ai_usage_daily where bucket = 'global' and day = (now() at time zone 'utc')::date - 10) then raise exception 'FAIL: old usage row kept'; end if;
  -- every step reported success and none failed
  if exists (select 1 from public.ops_app_events where code = 'maintenance_failed' or code = 'default_partition_rows') then
    raise exception 'FAIL: a clean maintenance run logged a failure'; end if;
  if (select count(distinct split_part(fingerprint, ':', 1)) from public.ops_app_events where code = 'maintenance_ok'
        and split_part(fingerprint, ':', 1) in ('partitions', 'retention', 'prune', 'anon_purge', 'health')) <> 5 then
    raise exception 'FAIL: not every step logged maintenance_ok: %', (select string_agg(fingerprint, ',') from public.ops_app_events where code = 'maintenance_ok'); end if;
  if not exists (select 1 from public.ops_app_events where code = 'maintenance_ok' and fingerprint = 'anon_purge:2') then
    raise exception 'FAIL: anon_purge count not in the summary event'; end if;
end $$;

-- a failing step is recorded and the other steps still run (isolation)
insert into auth.users (id, is_anonymous, created_at) values ('a0000000-0000-0000-0000-000000000007', true, now() - interval '90 days');
alter table public.core_settings disable trigger core_settings_touch;
update public.core_settings set updated_at = now() - interval '90 days' where owner_id = 'a0000000-0000-0000-0000-000000000007';
alter table public.core_settings enable trigger core_settings_touch;
create function public.tmp_block_user_delete() returns trigger language plpgsql as $$ begin raise exception 'blocked'; end $$;
create trigger tmp_block_user_delete before delete on auth.users for each row execute function public.tmp_block_user_delete();
do $$ declare v_next2 date := (date_trunc('month', now()) + interval '2 months')::date; begin
  execute format('drop table public.ops_app_events_%s', to_char(v_next2, 'YYYY_MM'));   -- another step has work to do
end $$;
set local role service_role;
select public.ops_maintenance_daily() as maintenance_with_failing_purge;
reset role;
do $$ begin
  if (select count(*) from public.ops_app_events where code = 'maintenance_failed' and fingerprint = 'anon_purge:P0001') <> 1 then
    raise exception 'FAIL: failing purge not recorded'; end if;
  if to_regclass('public.ops_app_events_' || to_char((date_trunc('month', now()) + interval '2 months')::date, 'YYYY_MM')) is null then
    raise exception 'FAIL: the partitions step did not run next to the failing purge'; end if;
  if not exists (select 1 from auth.users where id = 'a0000000-0000-0000-0000-000000000007') then
    raise exception 'FAIL: failing purge still deleted the user'; end if;
end $$;
drop trigger tmp_block_user_delete on auth.users;
drop function public.tmp_block_user_delete();

-- =============================================================================================
-- 9. Privilege and RLS regression guards (apply to every table and function, present and future)
-- =============================================================================================
-- defaults: a function or table created later is not reachable by anon, PUBLIC or authenticated
create function public.tmp_future_fn() returns int language sql as 'select 1';
create table public.tmp_future_tbl (id int);
create sequence public.tmp_future_seq;
do $$ begin
  if has_function_privilege('anon', 'public.tmp_future_fn()', 'execute') then raise exception 'FAIL: a new function is executable by anon'; end if;
  if has_function_privilege('authenticated', 'public.tmp_future_fn()', 'execute') then raise exception 'FAIL: a new function is executable by authenticated'; end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid = 'public.tmp_future_fn()'::regprocedure and a.grantee = 0) then
    raise exception 'FAIL: a new function is executable by PUBLIC'; end if;
  if has_table_privilege('anon', 'public.tmp_future_tbl', 'select,insert,update,delete') then raise exception 'FAIL: a new table is reachable by anon'; end if;
  if has_sequence_privilege('anon', 'public.tmp_future_seq', 'usage,select,update') then raise exception 'FAIL: a new sequence is reachable by anon'; end if;
end $$;
drop function public.tmp_future_fn();
drop table public.tmp_future_tbl;
drop sequence public.tmp_future_seq;

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

  -- no ops function is executable by users; partition creation is not even executable by service_role
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'ops\_%'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if bad is not null then raise exception 'FAIL: ops functions executable by users: %', bad; end if;
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('ops_create_month_partition', 'ops_create_ai_event_partition', 'ops_create_app_event_partition')
    and has_function_privilege('service_role', p.oid, 'execute');
  if bad is not null then raise exception 'FAIL: partition functions executable by service_role: %', bad; end if;

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
  -- the export is volatile (never cached, never reused by the planner)
  if exists (select 1 from pg_proc where proname = 'core_export_my_data' and provolatile <> 'v') then raise exception 'FAIL: core_export_my_data is not volatile'; end if;
end $$;

select 'ALL PROD V2 TESTS PASSED' as result;
rollback;
