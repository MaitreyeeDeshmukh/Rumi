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
  begin
    perform public.sync_push('{"appointments":[{"id":"no-consent","body":{}}]}'::jsonb);
    raise exception 'FAIL: sync_push allowed without cloud_sync consent';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('appointment-docs', 'aaaaaaaa-0000-0000-0000-00000000000a/appt-a1/no-consent');
    raise exception 'FAIL: file upload allowed without cloud_sync consent';
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

-- ===== User A: sync rows, last write wins, files =====
select public.sync_push('{
  "appointments":[{"id":"appt-a1","body":{"providerName":"Dr A"},"created_at":"2026-11-01T09:00:00Z","updated_at":"2026-11-01T10:00:00Z"}],
  "documents":[{"id":"doc-a1","appt_id":"appt-a1","kind":"text","name":"letter","excerpt":"bring ID","confirmed":true,"updated_at":"2026-11-01T10:00:00Z"}],
  "chats":[{"id":"chat-a1","kind":"get-ready","appt_id":"appt-a1","updated_at":"2026-11-01T10:00:00Z","messages":[{"role":"me","text":"hi"},{"role":"rumi","text":"hello"}]}]
}'::jsonb);
insert into storage.objects (bucket_id, name) values ('appointment-docs', 'aaaaaaaa-0000-0000-0000-00000000000a/appt-a1/doc-a1');

do $$ declare n int; begin
  -- an older change does not overwrite; a newer one does
  perform public.sync_push('{"appointments":[{"id":"appt-a1","body":{"providerName":"OLD"},"updated_at":"2026-10-01T10:00:00Z"}]}'::jsonb);
  if (select body ->> 'providerName' from public.appt_appointments where id = 'appt-a1') <> 'Dr A' then raise exception 'FAIL: older change overwrote a newer one'; end if;
  perform public.sync_push('{"appointments":[{"id":"appt-a1","body":{"providerName":"Dr A2"},"updated_at":"2026-11-02T10:00:00Z"}]}'::jsonb);
  if (select body ->> 'providerName' from public.appt_appointments where id = 'appt-a1') <> 'Dr A2' then raise exception 'FAIL: newer change was ignored'; end if;
  -- a thread's lines are replaced as a whole, only by a newer change
  perform public.sync_push('{"chats":[{"id":"chat-a1","kind":"get-ready","updated_at":"2026-11-02T10:00:00Z","messages":[{"role":"me","text":"one"}]}]}'::jsonb);
  select count(*) into n from public.chat_messages where thread_id = 'chat-a1';
  if n <> 1 then raise exception 'FAIL: chat lines not replaced (%)', n; end if;
  perform public.sync_push('{"chats":[{"id":"chat-a1","kind":"get-ready","updated_at":"2026-10-01T10:00:00Z","messages":[{"role":"me","text":"x"},{"role":"me","text":"y"}]}]}'::jsonb);
  select count(*) into n from public.chat_messages where thread_id = 'chat-a1';
  if n <> 1 then raise exception 'FAIL: an older chat change replaced newer lines (%)', n; end if;
  -- a document whose appointment is not stored is skipped, not an error
  perform public.sync_push('{"documents":[{"id":"orphan","appt_id":"nope","kind":"text","updated_at":"2026-11-02T10:00:00Z"}]}'::jsonb);
  if exists (select 1 from public.appt_documents where id = 'orphan') then raise exception 'FAIL: orphan document stored'; end if;
  -- a time in the far future is clamped
  perform public.sync_push('{"appointments":[{"id":"appt-future","body":{},"updated_at":"2999-01-01T00:00:00Z"}]}'::jsonb);
  if (select updated_at from public.appt_appointments where id = 'appt-future') > now() + interval '6 minutes' then raise exception 'FAIL: future time not clamped'; end if;
  -- deleting wipes the content and the documents under it, and keeps a tombstone
  perform public.sync_push('{"appointments":[{"id":"appt-gone","body":{"a":1},"updated_at":"2026-11-01T10:00:00Z"}],"documents":[{"id":"doc-gone","appt_id":"appt-gone","kind":"text","name":"n","excerpt":"secret words","updated_at":"2026-11-01T10:00:00Z"}]}'::jsonb);
  perform public.sync_push('{"appointments":[{"id":"appt-gone","deleted":true,"updated_at":"2026-11-04T10:00:00Z"}]}'::jsonb);
  if (select body from public.appt_appointments where id = 'appt-gone') <> '{}'::jsonb or (select deleted_at from public.appt_appointments where id = 'appt-gone') is null
    then raise exception 'FAIL: delete did not wipe and mark the appointment'; end if;
  if (select excerpt from public.appt_documents where id = 'doc-gone') <> '' or (select deleted_at from public.appt_documents where id = 'doc-gone') is null
    then raise exception 'FAIL: deleting an appointment left its document excerpt'; end if;
  -- pull returns it all: three appointments (two live, one tombstone), the thread with its one line
  if jsonb_array_length(public.sync_pull() -> 'appointments') <> 3 or jsonb_array_length(public.sync_pull() -> 'chats' -> 0 -> 'messages') <> 1
    then raise exception 'FAIL: sync_pull shape wrong'; end if;
  -- bad input is refused
  begin perform public.sync_push('{"appointments":{"id":"x"}}'::jsonb); raise exception 'FAIL: non-array accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.sync_push('{"chats":[{"id":"bad id!","kind":"get-ready","messages":[]}]}'::jsonb); raise exception 'FAIL: bad id accepted';
  exception when check_violation then null; end;
  begin perform public.sync_push('{"chats":[{"id":"c9","kind":"get-ready","messages":[{"role":"robot","text":"x"}]}]}'::jsonb); raise exception 'FAIL: bad role accepted';
  exception when check_violation then null; end;
  -- files: only in your own folder, exactly owner/appointment/file
  begin insert into storage.objects (bucket_id, name) values ('appointment-docs', 'bbbbbbbb-0000-0000-0000-00000000000b/appt-b/spoof'); raise exception 'FAIL: A wrote into B folder';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('appointment-docs', 'aaaaaaaa-0000-0000-0000-00000000000a/flat'); raise exception 'FAIL: wrong path depth accepted';
  exception when insufficient_privilege then null; end;
  if (select public from storage.buckets where id = 'appointment-docs') then raise exception 'FAIL: bucket is public'; end if;
  if (select file_size_limit from storage.buckets where id = 'appointment-docs') is null then raise exception 'FAIL: bucket has no size limit'; end if;
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
  -- sync tables and files
  if (select count(*) from public.appt_appointments) <> 0 then raise exception 'FAIL: B can read A appointments'; end if;
  if (select count(*) from public.appt_documents) <> 0 then raise exception 'FAIL: B can read A documents'; end if;
  if (select count(*) from public.chat_threads) <> 0 then raise exception 'FAIL: B can read A chats'; end if;
  if (select count(*) from public.chat_messages) <> 0 then raise exception 'FAIL: B can read A chat lines'; end if;
  if (select count(*) from storage.objects where bucket_id = 'appointment-docs') <> 0 then raise exception 'FAIL: B can see A files'; end if;
  if public.sync_pull() <> '{"appointments":[],"documents":[],"chats":[]}'::jsonb then raise exception 'FAIL: B pull returns A data'; end if;
  update public.appt_appointments set body = '{"hacked":true}'::jsonb;
  if found then raise exception 'FAIL: B updated A appointment'; end if;
  delete from public.appt_appointments;
  if found then raise exception 'FAIL: B deleted A appointment'; end if;
  delete from public.chat_threads;
  if found then raise exception 'FAIL: B deleted A chat'; end if;
  delete from storage.objects where bucket_id = 'appointment-docs';
  if found then raise exception 'FAIL: B deleted A file'; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('appointment-docs', 'aaaaaaaa-0000-0000-0000-00000000000a/appt-a1/by-b');
    raise exception 'FAIL: B wrote into A folder';
  exception when insufficient_privilege then null; end;
  -- B pushing A's ids makes B's own rows; A's stay as they are (checked below, as A)
  perform public.sync_push('{"appointments":[{"id":"appt-a1","body":{"providerName":"B WAS HERE"},"updated_at":"2026-12-01T00:00:00Z"}]}'::jsonb);
end $$;

-- ===== A's data is untouched by B =====
reset role;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select body ->> 'providerName' from public.appt_appointments where id = 'appt-a1') <> 'Dr A2' then raise exception 'FAIL: B changed A appointment'; end if;
  if (select count(*) from storage.objects where bucket_id = 'appointment-docs') <> 1 then raise exception 'FAIL: A file missing or extra'; end if;
end $$;

-- ===== anon and server-only tables =====
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.plan_visit_plans limit 1; raise exception 'FAIL: anon can read plans';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.appt_appointments limit 1; raise exception 'FAIL: anon can read appointments';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.chat_messages limit 1; raise exception 'FAIL: anon can read chat lines';
  exception when insufficient_privilege then null; end;
  begin perform public.sync_pull(); raise exception 'FAIL: anon can call sync_pull';
  exception when insufficient_privilege then null; end;
  begin
    if (select count(*) from storage.objects where bucket_id = 'appointment-docs') <> 0 then raise exception 'FAIL: anon can see files'; end if;
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
  if (select count(*) from public.appt_appointments) + (select count(*) from public.appt_documents)
     + (select count(*) from public.chat_threads) + (select count(*) from public.chat_messages) <> 0 then raise exception 'FAIL: delete left synced rows'; end if;
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
