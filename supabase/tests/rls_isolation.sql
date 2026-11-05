-- RLS isolation test. Run against a database with the Rumi schema:
--   bash scripts/db/run-sql.sh supabase/tests/rls_isolation.sql      (LOCAL stack: npx supabase start)
-- Everything runs in one transaction and is rolled back. Any broken rule raises an error.
begin;

insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b');

-- Sign-up trigger must have created default profile and settings.
do $$ begin
  if (select count(*) from public.core_profiles where owner_id in ('aaaaaaaa-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-00000000000b')) <> 2
    then raise exception 'FAIL: sign-up trigger did not create profiles'; end if;
  if (select count(*) from public.core_settings where owner_id in ('aaaaaaaa-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-00000000000b')) <> 2
    then raise exception 'FAIL: sign-up trigger did not create settings'; end if;
end $$;

-- ===== User A =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);

do $$ begin
  -- 1. Content needs consent.
  begin
    insert into public.plan_visit_plans (title) values ('no consent');
    raise exception 'FAIL: plan insert allowed without cloud_sync consent';
  exception when insufficient_privilege then null; end;
end $$;

insert into public.core_consents (kind, granted, policy_version, granted_at) values ('cloud_sync', true, 'v1', now());
insert into public.plan_visit_plans (id, title, main_concern)
  values ('11111111-0000-0000-0000-00000000000a', 'A plan', 'headaches');
insert into public.plan_items (plan_id, position, local_id, text, kind, source)
  values ('11111111-0000-0000-0000-00000000000a', 0, 'q1', 'I want to ask why I get headaches.', 'question', 'user');

do $$ begin
  -- 2. Only one current plan per user.
  begin
    insert into public.plan_visit_plans (title) values ('second current plan');
    raise exception 'FAIL: second current plan allowed';
  exception when unique_violation then null; end;
  -- 3. Cannot write a row owned by someone else.
  begin
    insert into public.plan_visit_plans (owner_id, title, archived_at)
      values ('bbbbbbbb-0000-0000-0000-00000000000b', 'spoof', now());
    raise exception 'FAIL: wrote a row owned by another user';
  exception when insufficient_privilege then null; end;
  -- 4. Recap item with no evidence is rejected by the database.
  insert into public.recap_recaps (id, my_speaker) values ('22222222-0000-0000-0000-00000000000a', 'B');
  begin
    insert into public.recap_items (recap_id, position, section, text, evidence_line_nos)
      values ('22222222-0000-0000-0000-00000000000a', 0, 'discussed', 'no proof', '{}');
    raise exception 'FAIL: recap item without evidence allowed';
  exception when check_violation then null; end;
end $$;

-- ===== User B cannot see or touch A's data =====
reset role;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

do $$ begin
  if (select count(*) from public.plan_visit_plans) <> 0 then raise exception 'FAIL: B can read A plans'; end if;
  if (select count(*) from public.plan_items) <> 0 then raise exception 'FAIL: B can read A plan items'; end if;
  if (select count(*) from public.recap_recaps) <> 0 then raise exception 'FAIL: B can read A recaps'; end if;
  if (select count(*) from public.core_consents) <> 0 then raise exception 'FAIL: B can read A consents'; end if;
  update public.plan_visit_plans set title = 'hacked';
  if found then raise exception 'FAIL: B updated A plan'; end if;
  delete from public.plan_visit_plans;
  if found then raise exception 'FAIL: B deleted A plan'; end if;
  -- B (with consent) cannot hang a child row on A's plan: composite FK (plan_id, owner_id).
  insert into public.core_consents (kind, granted, policy_version) values ('cloud_sync', true, 'v1');
  begin
    insert into public.plan_items (plan_id, position, local_id, text, kind, source)
      values ('11111111-0000-0000-0000-00000000000a', 5, 'q9', 'cross-tenant', 'question', 'user');
    raise exception 'FAIL: B attached an item to A plan';
  exception when foreign_key_violation then null; end;
end $$;

-- ===== anon and server-only tables =====
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.plan_visit_plans limit 1; raise exception 'FAIL: anon can read plans';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform 1 from public.ops_ai_events limit 1; raise exception 'FAIL: user can read ops_ai_events';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.ops_ai_usage_daily limit 1; raise exception 'FAIL: user can read ops_ai_usage_daily';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.research_tester_sessions limit 1; raise exception 'FAIL: user can read research data';
  exception when insufficient_privilege then null; end;
  begin perform public.ops_bump_ai_usage('global', 1, 1); raise exception 'FAIL: user can call ops_bump_ai_usage';
  exception when insufficient_privilege then null; end;
end $$;

-- ===== Delete everything =====
select public.core_delete_my_data();
do $$ begin
  if (select count(*) from public.plan_visit_plans) <> 0 then raise exception 'FAIL: delete left plans'; end if;
  if (select count(*) from public.plan_items) <> 0 then raise exception 'FAIL: delete left plan items'; end if;
  if (select count(*) from public.recap_recaps) <> 0 then raise exception 'FAIL: delete left recaps'; end if;
  if (select count(*) from public.core_consents) <> 0 then raise exception 'FAIL: delete left consents'; end if;
  if (select count(*) from public.core_settings) <> 1 then raise exception 'FAIL: settings not reset'; end if;
end $$;

-- ===== Server (service_role): sharded counter =====
reset role;
set local role service_role;
do $$ declare i int; t record; begin
  for i in 1..40 loop perform public.ops_bump_ai_usage('global', 1, 100); end loop;
  select * into t from public.ops_ai_usage_total((now() at time zone 'utc')::date, 'global');
  if t.calls <> 40 or t.cost_micro_usd <> 4000 then raise exception 'FAIL: usage total wrong: % %', t.calls, t.cost_micro_usd; end if;
  insert into public.ops_ai_events (task, outcome, tier, latency_ms) values ('plan', 'ok', 'fast', 123);
  if (select count(*) from public.ops_ai_events_2026_11) + (select count(*) from public.ops_ai_events_2026_12) < 1 then
    raise exception 'FAIL: event not routed to a monthly partition'; end if;
  if (select count(*) from public.ops_ai_events_default) <> 0 then raise exception 'FAIL: event landed in default partition'; end if;
end $$;

reset role;
select 'ALL RLS TESTS PASSED' as result;
rollback;
