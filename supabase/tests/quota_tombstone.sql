-- ops_take_ai_quota and persona tombstones.  bash scripts/db/run-sql.sh supabase/tests/quota_tombstone.sql  (LOCAL stack)
-- Parallel behaviour of the quota is tested by scripts/db/quota-concurrency.sh.
begin;
insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-00000000000a'), ('bbbbbbbb-0000-0000-0000-00000000000b');

-- ===== quota: the function pins its lock timeout and runs as the caller =====
do $$ begin
  if not exists (select 1 from pg_proc p, unnest(p.proconfig) c where p.proname = 'ops_take_ai_quota' and c = 'lock_timeout=2s') then
    raise exception 'FAIL: ops_take_ai_quota does not pin lock_timeout = 2s'; end if;
  if exists (select 1 from pg_proc where proname = 'ops_take_ai_quota' and prosecdef) then raise exception 'FAIL: ops_take_ai_quota is security definer'; end if;
end $$;

-- ===== quota: who may call it =====
set local role authenticated;
do $$ begin
  begin perform public.ops_take_ai_quota(array['u:aaaaaaaa'], array[5]); raise exception 'FAIL: authenticated called ops_take_ai_quota';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.ops_take_ai_quota(array['u:aaaaaaaa'], array[5]); raise exception 'FAIL: anon called ops_take_ai_quota';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== quota: semantics (as service_role) =====
set local role service_role;
do $$ declare i int; used bigint; begin
  -- single bucket, limit 3: exactly 3 true, then false, and the counter stays at 3
  for i in 1..3 loop
    if not public.ops_take_ai_quota(array['u:00000001'], array[3]) then raise exception 'FAIL: call % refused below the limit', i; end if;
  end loop;
  if public.ops_take_ai_quota(array['u:00000001'], array[3]) then raise exception 'FAIL: 4th call allowed over the limit'; end if;
  select calls into used from public.ops_ai_usage_total((now() at time zone 'utc')::date, 'u:00000001');
  if used <> 3 then raise exception 'FAIL: refused call was counted (%)', used; end if;

  -- two buckets: one full bucket refuses the whole call and the OTHER bucket is not incremented
  perform public.ops_take_ai_quota(array['ip:0000000a', 'u:00000002'], array[100, 1]);               -- u:q2 now full, ip:a = 1
  if public.ops_take_ai_quota(array['ip:0000000a', 'u:00000002'], array[100, 1]) then raise exception 'FAIL: full bucket did not refuse'; end if;
  select calls into used from public.ops_ai_usage_total((now() at time zone 'utc')::date, 'ip:0000000a');
  if used <> 1 then raise exception 'FAIL: other bucket was incremented by a refused call (%)', used; end if;
  -- the limit is per bucket
  if not public.ops_take_ai_quota(array['ip:0000000a', 'u:00000003'], array[100, 1]) then raise exception 'FAIL: unrelated full bucket blocked a call'; end if;
  select calls into used from public.ops_ai_usage_total((now() at time zone 'utc')::date, 'ip:0000000a');
  if used <> 2 then raise exception 'FAIL: ip:a should be 2, is %', used; end if;

  -- counts made by the sharded counter are included
  perform public.ops_bump_ai_usage('u:00000004', 5, 0);
  if public.ops_take_ai_quota(array['u:00000004'], array[5]) then raise exception 'FAIL: sharded usage ignored by the quota'; end if;

  -- the longest allowed bucket works: c:ip: plus 32 hex characters
  if not public.ops_take_ai_quota(array['c:ip:' || repeat('b', 32)], array[1]) then raise exception 'FAIL: longest bucket refused'; end if;
  -- caller order does not matter: the function sorts the buckets itself
  if not public.ops_take_ai_quota(array['u:00000009', 'ip:00000009'], array[5, 5]) or not public.ops_take_ai_quota(array['ip:00000009', 'u:00000009'], array[5, 5]) then raise exception 'FAIL: reversed caller order refused'; end if;

  -- validation
  begin perform public.ops_take_ai_quota(array['u:0000000a'], array[1, 2]); raise exception 'FAIL: length mismatch accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array[]::text[], array[]::int[]); raise exception 'FAIL: empty arrays accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(null, null); raise exception 'FAIL: null arrays accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['u:0000000a','u:0000000b','u:0000000c','u:0000000d','u:0000000e'], array[1,1,1,1,1]); raise exception 'FAIL: 5 buckets accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['u:0000000a'], array[0]); raise exception 'FAIL: limit 0 accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['u:0000000a'], array[-1]); raise exception 'FAIL: negative limit accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['u:0000000a'], array[null]::int[]); raise exception 'FAIL: null limit accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['u:' || repeat('b', 33)], array[1]); raise exception 'FAIL: 33 hex characters accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['u:abcdefg1'], array[1]); raise exception 'FAIL: non-hex bucket accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['U:ABCDEF12'], array[1]); raise exception 'FAIL: uppercase bucket accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['u:abcdef1'], array[1]); raise exception 'FAIL: 7 hex characters accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['global2'], array[1]); raise exception 'FAIL: unknown bucket kind accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['x:abcdef12'], array[1]); raise exception 'FAIL: unknown prefix accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array[''], array[1]); raise exception 'FAIL: empty bucket accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['u:0000000a', 'u:0000000a'], array[1, 1]); raise exception 'FAIL: duplicate bucket accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ===== tombstones =====
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
set local role authenticated;
insert into public.core_consents (kind, granted, policy_version) values ('persona_memory', true, 'v1');
select public.persona_upsert_facts('[{"kind":"pacing","key":"one_question","client_updated_at":"2026-01-01T00:00:00Z"},
                                     {"kind":"support_pref","key":"p1","client_updated_at":"2026-01-01T00:00:00Z"}]');
do $$ declare n int; begin
  -- removing a fact leaves a tombstone
  delete from public.persona_facts where key = 'one_question';
  if (select count(*) from public.persona_removed where key = 'one_question') <> 1 then raise exception 'FAIL: no tombstone after removal'; end if;
  -- a stale device (older than the removal) cannot bring it back
  n := public.persona_upsert_facts('[{"kind":"pacing","key":"one_question","client_updated_at":"2026-01-02T00:00:00Z"}]');
  if n <> 0 or exists (select 1 from public.persona_facts where key = 'one_question') then raise exception 'FAIL: stale device re-added a removed fact'; end if;
  -- the other fact is unaffected
  if not exists (select 1 from public.persona_facts where key = 'p1') then raise exception 'FAIL: other fact lost'; end if;
  -- a deliberate re-add after the removal (newer than it) works and clears the tombstone
  n := public.persona_upsert_facts(jsonb_build_array(jsonb_build_object('kind','pacing','key','one_question','client_updated_at', now() + interval '1 minute')));
  if n <> 1 or not exists (select 1 from public.persona_facts where key = 'one_question') then raise exception 'FAIL: newer re-add refused'; end if;
  if exists (select 1 from public.persona_removed where key = 'one_question') then raise exception 'FAIL: tombstone kept after re-add'; end if;
  -- the export carries the tombstone (kind, key, removed_at only)
  delete from public.persona_facts where key = 'one_question';
  if public.core_export_my_data() -> 'persona_removed' <> (select jsonb_agg(jsonb_build_object('kind', kind, 'key', key, 'removed_at', removed_at)) from public.persona_removed) then
    raise exception 'FAIL: export does not carry the tombstones (or carries more than kind, key, removed_at)'; end if;
  if jsonb_array_length(public.core_export_my_data() -> 'persona_removed') <> 1 then raise exception 'FAIL: export tombstone count'; end if;
  perform public.persona_upsert_facts(jsonb_build_array(jsonb_build_object('kind','pacing','key','one_question','client_updated_at', now() + interval '1 minute')));
  -- users cannot forge a tombstone
  begin insert into public.persona_removed (kind, key) values ('pacing', 'extra_time'); raise exception 'FAIL: user inserted a tombstone';
  exception when insufficient_privilege then null; end;
  -- forget_all clears facts AND tombstones
  delete from public.persona_facts where key = 'p1';
  if (select count(*) from public.persona_removed) <> 1 then raise exception 'FAIL: expected 1 tombstone'; end if;
  if public.persona_forget_all() <> 0 then raise exception 'FAIL: forget_all left facts'; end if;
  if (select count(*) from public.persona_removed) <> 0 then raise exception 'FAIL: forget_all left tombstones'; end if;
end $$;

-- B cannot see A's tombstones; core_delete_my_data clears them; account deletion cascades with persona rows present
select public.persona_upsert_facts('[{"kind":"pacing","key":"extra_time","client_updated_at":"2026-01-01T00:00:00Z"}]');
delete from public.persona_facts where key = 'extra_time';
reset role;
set local "request.jwt.claims" = '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}';
set local role authenticated;
do $$ begin
  if (select count(*) from public.persona_removed) <> 0 then raise exception 'FAIL: B sees A tombstones'; end if;
end $$;
reset role;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
set local role authenticated;
do $$ begin
  if (select count(*) from public.persona_removed) <> 1 then raise exception 'FAIL: setup, tombstone missing'; end if;
  perform public.core_delete_my_data();
  if (select count(*) from public.persona_removed) <> 0 then raise exception 'FAIL: core_delete_my_data left tombstones'; end if;
end $$;
reset role;
do $$ begin
  -- deleting the user (cascade) must still work with facts present and must not leave tombstones behind
  insert into public.core_consents (owner_id, kind, granted, policy_version) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'persona_memory', true, 'v1');
  insert into public.persona_facts (owner_id, kind, key) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'pacing', 'extra_time');
  delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  if exists (select 1 from public.persona_facts where owner_id = 'bbbbbbbb-0000-0000-0000-00000000000b')
     or exists (select 1 from public.persona_removed where owner_id = 'bbbbbbbb-0000-0000-0000-00000000000b') then
    raise exception 'FAIL: account deletion left persona rows'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.persona_removed'::regclass) then raise exception 'FAIL: persona_removed has no RLS'; end if;
  if has_table_privilege('anon', 'public.persona_removed', 'select') then raise exception 'FAIL: anon can read tombstones'; end if;
end $$;

select 'ALL QUOTA AND TOMBSTONE TESTS PASSED' as result;
rollback;
