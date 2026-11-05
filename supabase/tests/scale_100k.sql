-- 100k-user scale check. Not standalone: scripts/db/scale-check.sh runs
--   begin; <scripts/db/seed-synthetic.sql>; <this file>; rollback;
-- against the LOCAL stack. Needs at least 6000 seeded users.
--
-- For every owner table, as role `authenticated` with a real JWT subject, it runs
-- EXPLAIN (ANALYZE, BUFFERS) on the SELECT, UPDATE, INSERT and DELETE path and FAILS if
--   * any plan scans a table of more than 1000 rows sequentially (RLS policies included), or
--   * any statement (cascade and foreign-key trigger time included) takes more than 1000 ms (a missing index shows as seconds;
--     the limit is loose because a busy laptop doubles timings).
-- A negative control proves the detector fires. Numbers are printed as NOTICE lines.
do $$ declare r record; begin   -- fresh planner statistics, as autovacuum would have after a real load
  for r in select format('%I.%I', n.nspname, c.relname) as q from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind in ('r', 'p') and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users')) loop
    execute 'analyze ' || r.q;
  end loop;
end $$;

create function public.tmp_explain_check(p_label text, p_stmt text) returns text
language plpgsql as $$
declare
  v jsonb; o record; viol text := ''; ms numeric; trig numeric; maxrows numeric;
begin
  execute 'explain (analyze, buffers, format json) ' || p_stmt into v;
  ms := (v -> 0 ->> 'Execution Time')::numeric;
  select coalesce(sum((t ->> 'Time')::numeric), 0) into trig from jsonb_array_elements(coalesce(v -> 0 -> 'Triggers', '[]')) t;
  for o in
    select coalesce(n ->> 'Schema', 'public') || '.' || coalesce(n ->> 'Relation Name', '?') as rel,
           coalesce((select greatest(c.reltuples, 0) from pg_class c
                      where c.relname = n ->> 'Relation Name' and c.relnamespace = coalesce(n ->> 'Schema', 'public')::regnamespace), 0) as rows
    from jsonb_path_query(v, 'lax $.** ? (@."Node Type" like_regex "Seq Scan")') n
  loop
    if o.rows > 1000 then viol := viol || ' SEQSCAN(' || o.rel || ' ~' || o.rows::bigint || ' rows)'; end if;
  end loop;
  select coalesce(max((n ->> 'Actual Rows')::numeric), 0) into maxrows from jsonb_path_query(v, 'lax $.** ? (exists(@."Actual Rows"))') n;
  if maxrows < 1 and p_label not like 'NEGATIVE%' then viol := viol || ' VACUOUS(no row was touched, the check measured nothing)'; end if;
  if ms > 1000 then viol := viol || ' SLOW(' || ms || 'ms)'; end if;
  raise notice '% exec=%ms triggers=%ms hit=% read=% root=% %',
    rpad(p_label, 46), round(ms, 2), round(trig, 2),
    v -> 0 -> 'Plan' ->> 'Shared Hit Blocks', v -> 0 -> 'Plan' ->> 'Shared Read Blocks', v -> 0 -> 'Plan' ->> 'Node Type',
    case when viol <> '' then '  <-- ' || viol else '' end;
  return viol;
end $$;

-- records a violation (visible across roles through a transaction-local setting)
create function public.tmp_run(p_label text, p_stmt text) returns void
language plpgsql as $$
declare v text := public.tmp_explain_check(p_label, p_stmt);
begin
  if v <> '' then
    perform set_config('rumi.scale_violations', coalesce(current_setting('rumi.scale_violations', true), '') || chr(10) || p_label || ':' || v, true);
  end if;
end $$;
grant execute on function public.tmp_explain_check(text, text), public.tmp_run(text, text) to authenticated, service_role;

do $$ declare n bigint; begin
  select count(*) into n from auth.users;
  if n < 6000 then raise exception 'seed first (need >= 6000 users, found %)', n; end if;
  raise notice 'seeded users=% plan_items~% practice_turns~% recap_transcript_lines~% persona_facts~%', n,
    (select reltuples::bigint from pg_class where oid = 'public.plan_items'::regclass),
    (select reltuples::bigint from pg_class where oid = 'public.practice_turns'::regclass),
    (select reltuples::bigint from pg_class where oid = 'public.recap_transcript_lines'::regclass),
    (select reltuples::bigint from pg_class where oid = 'public.persona_facts'::regclass);
  perform set_config('rumi.scale_violations', '', true);
end $$;

-- ===== negative control: an owner-less filter on a big table MUST be flagged =====
do $$ declare v text; begin   -- runs as the table owner on purpose: no RLS owner filter to help the planner
  v := public.tmp_explain_check('NEGATIVE CONTROL (unindexed filter)', $q$select * from public.plan_items where text = 'synthetic question 1'$q$);
  if v not like '%SEQSCAN(public.plan_items%' then raise exception 'FAIL: detector did not flag a seq scan on plan_items (got: %)', v; end if;
  -- a statement that touches no row would "pass" without measuring anything: it must be flagged too
  v := public.tmp_explain_check('VACUOUS CONTROL (no such owner)', $q$select * from public.plan_items where owner_id = '1a1a1a1a-0000-0000-0000-000000000000'$q$);
  if v not like '%VACUOUS%' then raise exception 'FAIL: detector did not flag a statement that touched no row (got: %)', v; end if;
end $$;

-- ===== phase A: SELECT, UPDATE, INSERT for user 4242 (has consents, plan, recap, facts) =====
set local role authenticated;
do $$
declare
  uid text := md5('u4242')::uuid::text;
  pid text := md5('p4242')::uuid::text;
  sid text := md5('s4242')::uuid::text;
  t text; col text;
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', uid), true);

  foreach t in array array['core_profiles','core_settings','core_consents','plan_visit_plans','plan_items','plan_support_cards',
    'plan_support_items','plan_support_top_questions','practice_sessions','practice_turns','practice_item_outcomes','recap_recaps',
    'recap_transcript_lines','recap_items','recap_unconfirmed_items','recap_plan_status','persona_facts'] loop
    perform public.tmp_run('SELECT ' || t, format('select * from public.%I where owner_id = %L', t, uid));
  end loop;
  perform public.tmp_run('SELECT current plan (partial index)', format('select * from public.plan_visit_plans where owner_id = %L and archived_at is null', uid));
  perform public.tmp_run('SELECT last 10 sessions', format('select * from public.practice_sessions where owner_id = %L order by started_at desc limit 10', uid));
  perform public.tmp_run('SELECT last 10 recaps', format('select * from public.recap_recaps where owner_id = %L order by created_at desc limit 10', uid));
  perform public.tmp_run('SELECT items of a plan', format('select * from public.plan_items where plan_id = %L order by position', pid));
  perform public.tmp_run('SELECT turns of a session', format('select * from public.practice_turns where session_id = %L order by turn_index', sid));
  perform public.tmp_run('SELECT consent check (policy function)', format('select * from public.core_consents where owner_id = %L and kind = ''cloud_sync''', uid));

  for t, col in select * from (values
    ('core_profiles','display_name'),('core_settings','theme'),('core_consents','granted'),('plan_visit_plans','title'),
    ('plan_items','text'),('plan_support_cards','updated_at'),('plan_support_items','text'),('plan_support_top_questions','plan_item_id'),
    ('practice_sessions','help_count'),('practice_turns','text'),('practice_item_outcomes','covered'),('recap_recaps','prompt_version'),
    ('recap_transcript_lines','text'),('recap_items','text'),('recap_unconfirmed_items','text'),('recap_plan_status','status'),
    ('persona_facts','level')) v(a, b)
  loop
    perform public.tmp_run('UPDATE ' || t, format('update public.%I set %I = %I where owner_id = %L', t, col, col, uid));
  end loop;

  -- INSERT path, parent first. The new plan is archived (one current plan per user).
  perform public.tmp_run('INSERT core_profiles (upsert)', format('insert into public.core_profiles (owner_id, display_name) values (%L, ''x'') on conflict (owner_id) do update set display_name = excluded.display_name', uid));
  perform public.tmp_run('INSERT core_settings (upsert)', format('insert into public.core_settings (owner_id, theme) values (%L, ''low'') on conflict (owner_id) do update set theme = excluded.theme', uid));
  perform public.tmp_run('INSERT core_consents', $q$insert into public.core_consents (kind, granted, policy_version) values ('research_counts', true, 'v1')$q$);
  perform public.tmp_run('INSERT plan_visit_plans', $q$insert into public.plan_visit_plans (id, title, archived_at) values ('ffffffff-0000-0000-0000-0000000000f1', 'p2', now())$q$);
  perform public.tmp_run('INSERT plan_items', $q$insert into public.plan_items (plan_id, position, local_id, text, kind, source) values ('ffffffff-0000-0000-0000-0000000000f1', 0, 'q0', 'x', 'question', 'user')$q$);
  perform public.tmp_run('INSERT plan_support_cards', $q$insert into public.plan_support_cards (id, plan_id) values ('ffffffff-0000-0000-0000-0000000000f2', 'ffffffff-0000-0000-0000-0000000000f1')$q$);
  perform public.tmp_run('INSERT plan_support_items', $q$insert into public.plan_support_items (card_id, position, text, source) values ('ffffffff-0000-0000-0000-0000000000f2', 0, 'x', 'user')$q$);
  perform public.tmp_run('INSERT plan_support_top_questions', $q$insert into public.plan_support_top_questions (card_id, position, plan_item_id) values ('ffffffff-0000-0000-0000-0000000000f2', 1, (select id from public.plan_items where plan_id = 'ffffffff-0000-0000-0000-0000000000f1' and position = 0))$q$);
  perform public.tmp_run('INSERT practice_sessions', $q$insert into public.practice_sessions (id, plan_id, focus) values ('ffffffff-0000-0000-0000-0000000000f3', 'ffffffff-0000-0000-0000-0000000000f1', 'whole')$q$);
  perform public.tmp_run('INSERT practice_turns', $q$insert into public.practice_turns (session_id, turn_index, role, text) values ('ffffffff-0000-0000-0000-0000000000f3', 0, 'me', 'x')$q$);
  perform public.tmp_run('INSERT practice_item_outcomes', $q$insert into public.practice_item_outcomes (session_id, plan_item_id) values ('ffffffff-0000-0000-0000-0000000000f3', (select id from public.plan_items where plan_id = 'ffffffff-0000-0000-0000-0000000000f1' and position = 0))$q$);
  perform public.tmp_run('INSERT recap_recaps', $q$insert into public.recap_recaps (id, plan_id, my_speaker) values ('ffffffff-0000-0000-0000-0000000000f4', 'ffffffff-0000-0000-0000-0000000000f1', 'B')$q$);
  perform public.tmp_run('INSERT recap_transcript_lines', $q$insert into public.recap_transcript_lines (recap_id, line_no, local_id, speaker, text) values ('ffffffff-0000-0000-0000-0000000000f4', 1, 'l1', 'A', 'x')$q$);
  perform public.tmp_run('INSERT recap_items', $q$insert into public.recap_items (recap_id, position, section, text, evidence_line_nos) values ('ffffffff-0000-0000-0000-0000000000f4', 0, 'discussed', 'x', '{1}')$q$);
  perform public.tmp_run('INSERT recap_unconfirmed_items', $q$insert into public.recap_unconfirmed_items (recap_id, position, text) values ('ffffffff-0000-0000-0000-0000000000f4', 0, 'x')$q$);
  perform public.tmp_run('INSERT recap_plan_status', $q$insert into public.recap_plan_status (recap_id, plan_item_id, status) values ('ffffffff-0000-0000-0000-0000000000f4', (select id from public.plan_items where plan_id = 'ffffffff-0000-0000-0000-0000000000f1' and position = 0), 'unclear')$q$);
  perform public.tmp_run('INSERT persona_facts (upsert)', $q$insert into public.persona_facts (kind, key) values ('pacing', 'one_question') on conflict (owner_id, kind, key) do update set level = excluded.level$q$);
end $$;

-- ===== phase B: DELETE per table (children first) for user 5000 =====
do $$
declare uid text := md5('u5000')::uuid::text; t text;
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', uid), true);
  foreach t in array array['plan_support_top_questions','practice_item_outcomes','recap_plan_status','recap_items','recap_unconfirmed_items',
    'recap_transcript_lines','recap_recaps','practice_turns','practice_sessions','plan_support_items','plan_support_cards','plan_items',
    'plan_visit_plans','persona_facts','core_consents','core_settings','core_profiles'] loop
    perform public.tmp_run('DELETE ' || t, format('delete from public.%I where owner_id = %L', t, uid));
  end loop;
end $$;

-- ===== phase C: cascades and RPCs =====
do $$
declare uid text := md5('u6000')::uuid::text; t0 timestamptz; ms numeric;
begin
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', uid), true);
  -- parent delete cascading through every child (what "Delete everything" does)
  perform public.tmp_run('DELETE plan_visit_plans cascade (parent first)', format('delete from public.plan_visit_plans where owner_id = %L', uid));
  uid := md5('u4242')::uuid::text;
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', uid), true);
  t0 := clock_timestamp(); perform public.core_export_my_data(); ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice '% exec=%ms', rpad('RPC core_export_my_data()', 46), round(ms, 2);
  if ms > 1000 then perform set_config('rumi.scale_violations', current_setting('rumi.scale_violations', true) || chr(10) || 'core_export_my_data slow ' || ms, true); end if;
  t0 := clock_timestamp(); perform public.persona_upsert_facts((select jsonb_agg(jsonb_build_object('kind','support_pref','key','p'||(1+g%6),'client_updated_at', now() + g * interval '1 second')) from generate_series(1,100) g)); ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice '% exec=%ms', rpad('RPC persona_upsert_facts(100 facts)', 46), round(ms, 2);
  if ms > 1000 then perform set_config('rumi.scale_violations', current_setting('rumi.scale_violations', true) || chr(10) || 'persona_upsert_facts slow ' || ms, true); end if;
  t0 := clock_timestamp(); perform public.core_ensure_my_rows(); ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice '% exec=%ms', rpad('RPC core_ensure_my_rows()', 46), round(ms, 2);
  t0 := clock_timestamp(); perform public.persona_forget_all(); ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice '% exec=%ms', rpad('RPC persona_forget_all()', 46), round(ms, 2);
end $$;

reset role;
do $$ begin
  -- account deletion (auth.users row) cascades to every owner table through the owner_id indexes
  perform public.tmp_run('DELETE auth.users cascade (account delete)', format('delete from auth.users where id = %L', md5('u7000')::uuid));
end $$;

-- ===== phase D: the maintenance steps on a realistic backlog (about 45k stale anonymous users, 2000 per run) =====
do $$ begin perform set_config('rumi.users_before', (select count(*) from auth.users)::text, true); end $$;
set local role service_role;
do $$ declare t0 timestamptz := clock_timestamp(); r jsonb; begin
  r := public.ops_maint_anon_purge();   -- flag off: counts only
  raise notice 'ops_maint_anon_purge() DRY RUN: % in % s', r, round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
end $$;
reset role;
do $$ begin
  if (select count(*) from auth.users)::text <> current_setting('rumi.users_before') then raise exception 'FAIL: dry run deleted users'; end if;
  update public.ops_feature_flags set enabled = true where key = 'anon_purge_enabled';
end $$;
set local role service_role;
do $$ declare t0 timestamptz; r jsonb; i integer; begin
  for i in 1..3 loop
    t0 := clock_timestamp();
    r := public.ops_maint_anon_purge();
    raise notice 'ops_maint_anon_purge() run %: % in % s', i, r, round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
  end loop;
  t0 := clock_timestamp(); r := public.ops_maint_prune(); raise notice 'ops_maint_prune(): % in % s', r, round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
  t0 := clock_timestamp(); r := public.ops_maint_partitions(); raise notice 'ops_maint_partitions(): % in % s', r, round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
  t0 := clock_timestamp(); r := public.ops_alert_snapshot(); raise notice 'ops_alert_snapshot() backlog=% in % s', r -> 'anonymous_user_backlog', round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
end $$;
reset role;
do $$ begin
  raise notice 'users before=% after=%', current_setting('rumi.users_before'), (select count(*) from auth.users);
end $$;

reset role;
do $$ declare v text := current_setting('rumi.scale_violations', true); begin
  if coalesce(v, '') <> '' then raise exception E'FAIL: scale violations:%', v; end if;
end $$;
select 'SCALE CHECK PASSED' as result;
