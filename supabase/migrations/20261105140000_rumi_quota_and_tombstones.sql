-- Rumi schema v3: atomic AI quota and persona removal tombstones. Forward-only, additive.
--   1. ops_ai_usage_daily.bucket may be up to 64 characters (CHECK replaced: new one validated first)
--   2. ops_take_ai_quota(buckets, limits): all-or-nothing per-bucket daily quota, safe under concurrency
--   3. persona_removed: a removed fact leaves a tombstone, so a stale device cannot bring it back
--      (persona_upsert_facts skips older rows, persona_forget_all and core_delete_my_data clear tombstones)

-- ---------------------------------------------------------------------------------------------
-- 1. bucket length 40 -> 64 (expand, then contract)
-- ---------------------------------------------------------------------------------------------
alter table public.ops_ai_usage_daily add constraint ops_ai_usage_daily_bucket_v2_check
  check (char_length(bucket) between 1 and 64) not valid;
alter table public.ops_ai_usage_daily validate constraint ops_ai_usage_daily_bucket_v2_check;
alter table public.ops_ai_usage_daily drop constraint ops_ai_usage_daily_bucket_check;

-- ---------------------------------------------------------------------------------------------
-- 2. Atomic quota. The caller passes the buckets SORTED (same order everywhere, so two callers can
--    never wait on each other). Each bucket is locked for the rest of the transaction; then, if ANY
--    bucket is already at its limit nothing is counted and false is returned; otherwise every bucket
--    is counted once (shard 0: these buckets are low-contention, the 'global' cost bucket keeps using
--    ops_bump_ai_usage with its 16 shards) and true is returned.
--    SECURITY INVOKER on purpose: it only needs the table rights service_role already has, and a
--    definer function would be a way around RLS for no gain. Locks need no privilege.
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_take_ai_quota(p_buckets text[], p_limits integer[])
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_day  date := (now() at time zone 'utc')::date;
  n      integer := coalesce(cardinality(p_buckets), 0);
  v_used bigint;
begin
  if n < 1 or n > 4 or n <> coalesce(cardinality(p_limits), 0) then
    raise exception 'buckets and limits must be 1 to 4 entries each, same length' using errcode = '22023'; end if;
  if (select count(distinct b) from unnest(p_buckets) b) <> n then
    raise exception 'duplicate bucket' using errcode = '22023'; end if;
  for i in 1..n loop
    if p_buckets[i] is null or char_length(p_buckets[i]) not between 1 and 64 then
      raise exception 'bucket must be 1 to 64 characters' using errcode = '22023'; end if;
    if p_limits[i] is null or p_limits[i] <= 0 then
      raise exception 'limit must be greater than 0' using errcode = '22023'; end if;
  end loop;

  for i in 1..n loop
    perform pg_advisory_xact_lock(hashtextextended(v_day::text || p_buckets[i], 0));
  end loop;
  for i in 1..n loop
    select coalesce(sum(u.calls), 0) into v_used from public.ops_ai_usage_daily u
    where u.day = v_day and u.bucket = p_buckets[i];
    if v_used >= p_limits[i] then return false; end if;
  end loop;
  for i in 1..n loop
    insert into public.ops_ai_usage_daily as u (day, bucket, shard, calls)
    values (v_day, p_buckets[i], 0, 1)
    on conflict (day, bucket, shard) do update set calls = u.calls + 1, updated_at = now();
  end loop;
  return true;
end $$;
revoke execute on function public.ops_take_ai_quota(text[], integer[]) from public, anon, authenticated;
grant  execute on function public.ops_take_ai_quota(text[], integer[]) to service_role;
comment on function public.ops_take_ai_quota(text[], integer[]) is '[OPS][SERVICE-ONLY] All-or-nothing daily quota over 1-4 sorted buckets. Returns false (nothing counted) if any bucket is at its limit.';

-- ---------------------------------------------------------------------------------------------
-- 3. Persona tombstones
-- ---------------------------------------------------------------------------------------------
create table public.persona_removed (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('support_pref', 'pacing', 'help_level')),
  key        text not null check (key ~ '^[a-z0-9_:.-]{1,60}$'),
  removed_at timestamptz not null default now(),
  primary key (owner_id, kind, key)
);
alter table public.persona_removed enable row level security;
-- Users may see and clear their own tombstones. Only the trigger below writes them.
create policy persona_removed_select_own on public.persona_removed for select to authenticated using ((select auth.uid()) = owner_id);
create policy persona_removed_delete_own on public.persona_removed for delete to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.persona_removed from public, anon, authenticated;
grant select, delete on public.persona_removed to authenticated;
grant all on public.persona_removed to service_role;
comment on table public.persona_removed is '[PERSONA][USER-CONTENT] Tombstone per removed fact (kind + key + time, no text). Stops a stale device from re-adding a removed fact. Cleared by persona_forget_all and account deletion.';

-- A direct delete of a fact leaves a tombstone. Depth 0 only: cascades (account deletion) do not.
create or replace function private.persona_tombstone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.persona_removed (owner_id, kind, key) values (old.owner_id, old.kind, old.key)
  on conflict (owner_id, kind, key) do update set removed_at = now();
  return old;
end $$;
revoke execute on function private.persona_tombstone() from public, anon, authenticated;
create trigger persona_facts_tombstone after delete on public.persona_facts
  for each row when (pg_trigger_depth() = 0) execute function private.persona_tombstone();

-- Upsert: rows not newer than their tombstone are skipped; a newer row clears the tombstone.
create or replace function public.persona_upsert_facts(p_facts jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_written integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    raise exception 'facts must be a json array' using errcode = '22023'; end if;
  if jsonb_array_length(p_facts) > 100 then
    raise exception 'too many facts (max 100)' using errcode = '54000'; end if;

  with b as (
    select distinct on (x.kind, x.key)
           x.kind, x.key, x.level, coalesce(x.client_updated_at, now()) as client_updated_at
    from jsonb_to_recordset(p_facts) as x(kind text, key text, level smallint, client_updated_at timestamptz)
    order by x.kind, x.key, coalesce(x.client_updated_at, now()) desc
  ), fresh as (
    select b.* from b
    where not exists (select 1 from public.persona_removed r
                      where r.owner_id = v_uid and r.kind = b.kind and r.key = b.key and r.removed_at >= b.client_updated_at)
  ), cleared as (
    delete from public.persona_removed r using fresh f
    where r.owner_id = v_uid and r.kind = f.kind and r.key = f.key
    returning 1
  )
  insert into public.persona_facts as f (owner_id, kind, key, level, client_updated_at)
  select v_uid, fresh.kind, fresh.key, fresh.level, fresh.client_updated_at from fresh
  on conflict (owner_id, kind, key) do update
    set level = excluded.level, client_updated_at = excluded.client_updated_at
    where excluded.client_updated_at > f.client_updated_at;
  get diagnostics v_written = row_count;
  return v_written;
end $$;

create or replace function public.persona_forget_all()
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.persona_facts where owner_id = v_uid;
  delete from public.persona_removed where owner_id = v_uid;   -- forgetting everything forgets the tombstones too
  return (select count(*)::integer from public.persona_facts where owner_id = v_uid);
end $$;

create or replace function public.core_delete_my_data()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  delete from public.recap_recaps where owner_id = v_uid;
  delete from public.plan_visit_plans where owner_id = v_uid;   -- cascades plans, cards, sessions
  delete from public.persona_facts where owner_id = v_uid;
  delete from public.persona_removed where owner_id = v_uid;
  delete from public.core_consents where owner_id = v_uid;
  update public.core_profiles set display_name = null, companion_name = 'Rumi' where owner_id = v_uid;
  delete from public.core_settings where owner_id = v_uid;
  insert into public.core_settings (owner_id) values (v_uid);
end $$;
