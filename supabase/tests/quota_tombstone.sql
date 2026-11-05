-- ops_take_ai_quota and persona tombstones.  bash scripts/db/run-sql.sh supabase/tests/quota_tombstone.sql  (LOCAL stack)
-- Parallel behaviour of the quota is tested by scripts/db/quota-concurrency.sh.
begin;
insert into auth.users (id) values ('aaaaaaaa-0000-0000-0000-00000000000a'), ('bbbbbbbb-0000-0000-0000-00000000000b');

-- ===== quota: who may call it =====
set local role authenticated;
do $$ begin
  begin perform public.ops_take_ai_quota(array['u:x'], array[5]); raise exception 'FAIL: authenticated called ops_take_ai_quota';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.ops_take_ai_quota(array['u:x'], array[5]); raise exception 'FAIL: anon called ops_take_ai_quota';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===== quota: semantics (as service_role) =====
set local role service_role;
do $$ declare i int; used bigint; begin
  -- single bucket, limit 3: exactly 3 true, then false, and the counter stays at 3
  for i in 1..3 loop
    if not public.ops_take_ai_quota(array['u:q1'], array[3]) then raise exception 'FAIL: call % refused below the limit', i; end if;
  end loop;
  if public.ops_take_ai_quota(array['u:q1'], array[3]) then raise exception 'FAIL: 4th call allowed over the limit'; end if;
  select calls into used from public.ops_ai_usage_total((now() at time zone 'utc')::date, 'u:q1');
  if used <> 3 then raise exception 'FAIL: refused call was counted (%)', used; end if;

  -- two buckets: one full bucket refuses the whole call and the OTHER bucket is not incremented
  perform public.ops_take_ai_quota(array['ip:a', 'u:q2'], array[100, 1]);               -- u:q2 now full, ip:a = 1
  if public.ops_take_ai_quota(array['ip:a', 'u:q2'], array[100, 1]) then raise exception 'FAIL: full bucket did not refuse'; end if;
  select calls into used from public.ops_ai_usage_total((now() at time zone 'utc')::date, 'ip:a');
  if used <> 1 then raise exception 'FAIL: other bucket was incremented by a refused call (%)', used; end if;
  -- the limit is per bucket
  if not public.ops_take_ai_quota(array['ip:a', 'u:q3'], array[100, 1]) then raise exception 'FAIL: unrelated full bucket blocked a call'; end if;
  select calls into used from public.ops_ai_usage_total((now() at time zone 'utc')::date, 'ip:a');
  if used <> 2 then raise exception 'FAIL: ip:a should be 2, is %', used; end if;

  -- counts made by the sharded counter are included
  perform public.ops_bump_ai_usage('u:q4', 5, 0);
  if public.ops_take_ai_quota(array['u:q4'], array[5]) then raise exception 'FAIL: sharded usage ignored by the quota'; end if;

  -- a bucket of 64 characters works (check widened from 40)
  if not public.ops_take_ai_quota(array[repeat('b', 64)], array[1]) then raise exception 'FAIL: 64 char bucket refused'; end if;

  -- validation
  begin perform public.ops_take_ai_quota(array['a'], array[1, 2]); raise exception 'FAIL: length mismatch accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array[]::text[], array[]::int[]); raise exception 'FAIL: empty arrays accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(null, null); raise exception 'FAIL: null arrays accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['a','b','c','d','e'], array[1,1,1,1,1]); raise exception 'FAIL: 5 buckets accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['a'], array[0]); raise exception 'FAIL: limit 0 accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['a'], array[-1]); raise exception 'FAIL: negative limit accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['a'], array[null]::int[]); raise exception 'FAIL: null limit accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array[repeat('b', 65)], array[1]); raise exception 'FAIL: 65 char bucket accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array[''], array[1]); raise exception 'FAIL: empty bucket accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.ops_take_ai_quota(array['a', 'a'], array[1, 1]); raise exception 'FAIL: duplicate bucket accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ===== tombstones =====
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
set local role authenticated;
insert into public.core_consents (kind, granted, policy_version) values ('persona_memory', true, 'v1');
select public.persona_upsert_facts('[{"kind":"pacing","key":"slow","client_updated_at":"2026-01-01T00:00:00Z"},
                                     {"kind":"support_pref","key":"quiet","client_updated_at":"2026-01-01T00:00:00Z"}]');
do $$ declare n int; begin
  -- removing a fact leaves a tombstone
  delete from public.persona_facts where key = 'slow';
  if (select count(*) from public.persona_removed where key = 'slow') <> 1 then raise exception 'FAIL: no tombstone after removal'; end if;
  -- a stale device (older than the removal) cannot bring it back
  n := public.persona_upsert_facts('[{"kind":"pacing","key":"slow","client_updated_at":"2026-01-02T00:00:00Z"}]');
  if n <> 0 or exists (select 1 from public.persona_facts where key = 'slow') then raise exception 'FAIL: stale device re-added a removed fact'; end if;
  -- the other fact is unaffected
  if not exists (select 1 from public.persona_facts where key = 'quiet') then raise exception 'FAIL: other fact lost'; end if;
  -- a deliberate re-add after the removal (newer than it) works and clears the tombstone
  n := public.persona_upsert_facts(jsonb_build_array(jsonb_build_object('kind','pacing','key','slow','client_updated_at', now() + interval '1 minute')));
  if n <> 1 or not exists (select 1 from public.persona_facts where key = 'slow') then raise exception 'FAIL: newer re-add refused'; end if;
  if exists (select 1 from public.persona_removed where key = 'slow') then raise exception 'FAIL: tombstone kept after re-add'; end if;
  -- the export carries the tombstone (kind, key, removed_at only)
  delete from public.persona_facts where key = 'slow';
  if public.core_export_my_data() -> 'persona_removed' <> (select jsonb_agg(jsonb_build_object('kind', kind, 'key', key, 'removed_at', removed_at)) from public.persona_removed) then
    raise exception 'FAIL: export does not carry the tombstones (or carries more than kind, key, removed_at)'; end if;
  if jsonb_array_length(public.core_export_my_data() -> 'persona_removed') <> 1 then raise exception 'FAIL: export tombstone count'; end if;
  perform public.persona_upsert_facts(jsonb_build_array(jsonb_build_object('kind','pacing','key','slow','client_updated_at', now() + interval '1 minute')));
  -- users cannot forge a tombstone
  begin insert into public.persona_removed (kind, key) values ('pacing', 'forged'); raise exception 'FAIL: user inserted a tombstone';
  exception when insufficient_privilege then null; end;
  -- forget_all clears facts AND tombstones
  delete from public.persona_facts where key = 'quiet';
  if (select count(*) from public.persona_removed) <> 1 then raise exception 'FAIL: expected 1 tombstone'; end if;
  if public.persona_forget_all() <> 0 then raise exception 'FAIL: forget_all left facts'; end if;
  if (select count(*) from public.persona_removed) <> 0 then raise exception 'FAIL: forget_all left tombstones'; end if;
end $$;

-- B cannot see A's tombstones; core_delete_my_data clears them; account deletion cascades with persona rows present
select public.persona_upsert_facts('[{"kind":"pacing","key":"x","client_updated_at":"2026-01-01T00:00:00Z"}]');
delete from public.persona_facts where key = 'x';
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
  insert into public.persona_facts (owner_id, kind, key) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'pacing', 'y');
  delete from auth.users where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  if exists (select 1 from public.persona_facts where owner_id = 'bbbbbbbb-0000-0000-0000-00000000000b')
     or exists (select 1 from public.persona_removed where owner_id = 'bbbbbbbb-0000-0000-0000-00000000000b') then
    raise exception 'FAIL: account deletion left persona rows'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.persona_removed'::regclass) then raise exception 'FAIL: persona_removed has no RLS'; end if;
  if has_table_privilege('anon', 'public.persona_removed', 'select') then raise exception 'FAIL: anon can read tombstones'; end if;
end $$;

select 'ALL QUOTA AND TOMBSTONE TESTS PASSED' as result;
rollback;
