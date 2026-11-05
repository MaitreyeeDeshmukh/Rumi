-- Rumi production migration A of E: ADDITIVE OBJECTS. New tables, new columns without CHECKs, functions, flags.
--
-- The production set is five small files, each ONE transaction that gives up fast instead of queueing behind
-- traffic (a queued ALTER TABLE blocks every later query on that table):
--   A  (this file)  additive objects: tables, columns, functions, flags
--   B  NOT VALID constraints only (short lock; a guard refuses to continue if existing rows break the new rules)
--   C  VALIDATE CONSTRAINT (does not block writes) and drop of the superseded constraints
--   D  triggers (persona tombstone)
--   E  pg_cron jobs, role timeouts, default privileges
--   then 20261105130000 metric views and the alert snapshot.
-- Apply in this order. A failed file changes nothing (drilled by scripts/db/rollback-drill.sh, lock behaviour
-- by the same script). To undo a successful apply, ship a forward migration.
--
-- Every function sets search_path = '' and has explicit grants. Ops tables: RLS on, no user policy.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------
-- 1. Feature flags (kill switches). service_role only: users never read or write them.
--    anon_purge_enabled stays FALSE until an operator has looked at the dry-run counts.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.ops_feature_flags (
  key        text primary key check (key ~ '^[a-z_]{1,40}$'),
  enabled    boolean not null,
  updated_at timestamptz not null default now()
);
alter table public.ops_feature_flags enable row level security;
revoke all on public.ops_feature_flags from public, anon, authenticated;
grant all on public.ops_feature_flags to service_role;
drop trigger if exists ops_feature_flags_touch on public.ops_feature_flags;
create trigger ops_feature_flags_touch before update on public.ops_feature_flags
  for each row execute function private.touch_updated_at();

insert into public.ops_feature_flags (key, enabled) values
  ('ai_enabled', true), ('memory_sync_enabled', true), ('cloud_sync_enabled', false), ('anon_purge_enabled', false)
on conflict (key) do nothing;

comment on table public.ops_feature_flags is '[OPS][SERVICE-ONLY] Kill switches read by the server (cached 30 s). Flip with: update public.ops_feature_flags set enabled = false where key = ''ai_enabled''; anon_purge_enabled (default false) arms the anonymous-user purge.';

-- ---------------------------------------------------------------------------------------------
-- 2. Database-side event logging that can never fail its caller
-- ---------------------------------------------------------------------------------------------
-- Used by triggers and maintenance jobs: a failure to log is swallowed on purpose (a log write must never block a
-- sign-up or a maintenance step; the failure itself is visible as a missing maintenance_ok event in the alert snapshot).
create or replace function private.log_db_event(p_area text, p_code text, p_fingerprint text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.ops_app_events (source, area, code, fingerprint) values ('db', p_area, p_code, p_fingerprint);
  exception when others then
    null; -- see header: logging must not block the caller
  end;
end $$;
revoke execute on function private.log_db_event(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. App events: errors and notable events from server, client and database. No text, no user id.
--    A new, empty table: its CHECKs are inline (nothing to scan, nothing to lock). The formats are the ones the
--    app's own sinks produce (lib/telemetry/sinks.ts), so real telemetry is never rejected; the database's own
--    SQLSTATE fingerprints ('partitions:42501') fit too.
-- ---------------------------------------------------------------------------------------------
create sequence if not exists public.ops_app_events_id_seq;

create table if not exists public.ops_app_events (
  id          bigint not null default nextval('public.ops_app_events_id_seq'),
  created_at  timestamptz not null default now(),
  source      text not null check (source in ('server', 'client', 'db')),
  area        text not null check (area in ('auth', 'db', 'ai', 'memory', 'app', 'sync')),
  code        text not null check (char_length(code) <= 60 and code ~ '^[a-z0-9_.:-]+$'),
  fingerprint text check (fingerprint ~ '^[A-Za-z0-9:_-]{1,64}$'),
  route       text check (route ~ '^(/[]A-Za-z0-9/_.[()@-]{0,79}|unknown)$'),
  release     text check (release ~ '^[A-Za-z0-9._-]{1,40}$'),
  status      smallint check (status between 100 and 599),
  primary key (created_at, id)
) partition by range (created_at);
alter sequence public.ops_app_events_id_seq owned by public.ops_app_events.id;
create index if not exists ops_app_events_area_created_idx on public.ops_app_events (area, created_at desc);

-- One function creates a monthly partition of either event table. Rows for that month that already landed in the
-- default partition (a cron outage) are moved first, so creation never fails with "default partition would be
-- violated". If another session creates the same month at the same moment (duplicate table, busy lock), look once more.
-- Invoker on purpose and NOT executable by service_role (creating tables needs rights it does not have): the
-- maintenance jobs, which are definer functions owned by postgres, are the only callers.
create or replace function public.ops_create_month_partition(p_parent text, p_month date)
returns void language plpgsql set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text;
begin
  if p_parent not in ('ops_ai_events', 'ops_app_events') then
    raise exception 'unsupported parent table %', p_parent using errcode = '22023';
  end if;
  v_name := p_parent || '_' || to_char(v_start, 'YYYY_MM');
  for v_try in 1..2 loop
    if to_regclass(format('public.%I', v_name)) is not null then return; end if;
    begin
      execute format('create table public.%I (like public.%I including all)', v_name, p_parent);
      execute format(
        'with moved as (delete from public.%I where created_at >= %L and created_at < %L returning *) insert into public.%I select * from moved',
        p_parent || '_default', v_start, v_end, v_name);
      execute format('alter table public.%I attach partition public.%I for values from (%L) to (%L)',
                     p_parent, v_name, v_start, v_end);
      execute format('alter table public.%I enable row level security', v_name);
      execute format('revoke all on public.%I from public, anon, authenticated', v_name);
      return;
    exception when duplicate_table or duplicate_object or lock_not_available or deadlock_detected then
      if v_try = 2 then raise; end if;
    end;
  end loop;
end $$;

create or replace function public.ops_create_ai_event_partition(p_month date)
returns void language sql set search_path = '' as $$
  select public.ops_create_month_partition('ops_ai_events', p_month);
$$;

create or replace function public.ops_create_app_event_partition(p_month date)
returns void language sql set search_path = '' as $$
  select public.ops_create_month_partition('ops_app_events', p_month);
$$;

create table if not exists public.ops_app_events_default partition of public.ops_app_events default;
select public.ops_create_app_event_partition(d::date)
from generate_series('2026-11-01'::date, '2027-04-01'::date, interval '1 month') as d;

alter table public.ops_app_events enable row level security;
alter table public.ops_app_events_default enable row level security;
revoke all on public.ops_app_events, public.ops_app_events_default from public, anon, authenticated;
grant all on public.ops_app_events, public.ops_app_events_default to service_role;
revoke all on sequence public.ops_app_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.ops_app_events_id_seq to service_role;

-- Optional arguments default to null (the app's sink passes null for what it does not have).
create or replace function public.ops_log_app_event(
  p_source text, p_area text, p_code text, p_fingerprint text default null,
  p_route text default null, p_release text default null, p_status smallint default null)
returns void language sql set search_path = '' as $$
  insert into public.ops_app_events (source, area, code, fingerprint, route, release, status)
  values (p_source, p_area, p_code, p_fingerprint, p_route, p_release, p_status);
$$;

comment on table public.ops_app_events is '[OPS][SERVICE-ONLY] App and database error events, partitioned by month, kept 90 days. Code, fingerprint, route, release. Never text, never a user id.';
comment on table public.ops_app_events_default is '[OPS][SERVICE-ONLY] Catch-all partition. Should stay empty: the partitions job creates months 4 ahead.';

-- ---------------------------------------------------------------------------------------------
-- 4. New columns, no CHECK yet (the CHECKs come in file B as NOT VALID, then C validates them)
-- ---------------------------------------------------------------------------------------------
alter table public.ops_ai_events
  add column if not exists cache_status text,
  add column if not exists cached_tokens integer;

-- Constant-time add on PG 11+ (now() is stable, so no table rewrite).
alter table public.persona_facts add column if not exists client_updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------------------------
-- 5. Persona tombstones. A removed fact leaves (kind, key, time) so a stale device cannot bring it back.
--    A new, empty table: shape CHECK inline. At most 11 distinct (kind, key) pairs exist per person (3 kinds, fixed
--    key lists), so tombstone churn is bounded by 11 rows per person, rewritten in place; the 200-row cap and the
--    30-day prune in the prune job are defence in depth. The trigger itself is created in file D.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.persona_removed (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null,
  key        text not null,
  removed_at timestamptz not null default now(),
  primary key (owner_id, kind, key),
  constraint persona_removed_shape_check check (
    (kind = 'support_pref' and key ~ '^p[1-6]$')
    or (kind = 'pacing' and key in ('one_question', 'extra_time'))
    or (kind = 'help_level' and key in ('concern', 'question', 'accommodation')))
);
alter table public.persona_removed enable row level security;
drop policy if exists persona_removed_select_own on public.persona_removed;
drop policy if exists persona_removed_delete_own on public.persona_removed;
-- Users may see and clear their own tombstones. Only the trigger writes them.
create policy persona_removed_select_own on public.persona_removed for select to authenticated using ((select auth.uid()) = owner_id);
create policy persona_removed_delete_own on public.persona_removed for delete to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.persona_removed from public, anon, authenticated;
grant select, delete on public.persona_removed to authenticated;
grant all on public.persona_removed to service_role;
comment on table public.persona_removed is '[PERSONA][USER-CONTENT] Tombstone per removed fact (kind + key + time, no text). Stops a stale device from re-adding a removed fact. At most 11 possible rows per person. Cleared by persona_forget_all and account deletion; pruned after 30 days.';

create or replace function private.persona_tombstone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.persona_removed (owner_id, kind, key) values (old.owner_id, old.kind, old.key)
  on conflict (owner_id, kind, key) do update set removed_at = now();
  -- cap: keep the newest 200 per person (a removal must never be refused, so trim instead of rejecting)
  delete from public.persona_removed r
  where r.owner_id = old.owner_id
    and (r.kind, r.key) in (select p.kind, p.key from public.persona_removed p where p.owner_id = old.owner_id
                            order by p.removed_at desc, p.kind, p.key offset 200);
  return old;
end $$;
revoke execute on function private.persona_tombstone() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Persona functions (security invoker: RLS enforces ownership and the persona_memory consent)
-- ---------------------------------------------------------------------------------------------
-- Batch, idempotent, last-write-wins by the device timestamp. Returns the number of rows inserted or changed.
-- Limits: array of at most 100 elements (SQLSTATE 54000), at most 200 facts per person after the batch (54000),
-- client_updated_at must be finite (22023) and is clamped to 5 minutes ahead of the server clock, so a wrong device clock
-- cannot pin a fact forever. Facts not newer than their tombstone are skipped; a newer one clears the tombstone.
-- ponytail: the 200 cap is checked before the insert, two parallel batches can overshoot it by one batch; the shape CHECK
-- already limits a person to 11 distinct facts, so this is a backstop only.
create or replace function public.persona_upsert_facts(p_facts jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_written integer; v_existing integer; v_new integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    raise exception 'facts must be a json array' using errcode = '22023'; end if;
  if jsonb_array_length(p_facts) > 100 then
    raise exception 'too many facts (max 100)' using errcode = '54000'; end if;
  if exists (select 1 from jsonb_to_recordset(p_facts) as x(kind text, key text, level smallint, client_updated_at timestamptz)
             where x.client_updated_at is not null and not isfinite(x.client_updated_at)) then
    raise exception 'client_updated_at must be a finite time' using errcode = '22023'; end if;

  select count(*) into v_existing from public.persona_facts where owner_id = v_uid;
  select count(*) into v_new
  from (select distinct x.kind, x.key from jsonb_to_recordset(p_facts) as x(kind text, key text, level smallint, client_updated_at timestamptz)) b
  where not exists (select 1 from public.persona_facts f where f.owner_id = v_uid and f.kind = b.kind and f.key = b.key);
  if v_existing + v_new > 200 then
    raise exception 'too many persona facts (max 200 per person)' using errcode = '54000'; end if;

  with b as (
    select distinct on (x.kind, x.key)
           x.kind, x.key, x.level, least(coalesce(x.client_updated_at, now()), now() + interval '5 minutes') as client_updated_at
    from jsonb_to_recordset(p_facts) as x(kind text, key text, level smallint, client_updated_at timestamptz)
    order by x.kind, x.key, least(coalesce(x.client_updated_at, now()), now() + interval '5 minutes') desc
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

-- Deletes every fact and tombstone of the caller and returns how many facts are left (must be 0).
create or replace function public.persona_forget_all()
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.persona_facts where owner_id = v_uid;
  delete from public.persona_removed where owner_id = v_uid;   -- forgetting everything forgets the tombstones too
  return (select count(*)::integer from public.persona_facts where owner_id = v_uid);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Self-heal, "Delete everything", export (security invoker: RLS applies on top of the owner filter)
-- ---------------------------------------------------------------------------------------------
create or replace function public.core_ensure_my_rows()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into public.core_profiles (owner_id) values (v_uid) on conflict do nothing;
  insert into public.core_settings (owner_id) values (v_uid) on conflict do nothing;
end $$;

create or replace function public.core_delete_my_data()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.recap_recaps where owner_id = v_uid;
  delete from public.plan_visit_plans where owner_id = v_uid;   -- cascades plans, cards, sessions
  delete from public.persona_facts where owner_id = v_uid;
  delete from public.persona_removed where owner_id = v_uid;
  delete from public.core_consents where owner_id = v_uid;
  update public.core_profiles set display_name = null, companion_name = 'Rumi' where owner_id = v_uid;
  delete from public.core_settings where owner_id = v_uid;
  insert into public.core_settings (owner_id) values (v_uid);
end $$;

-- Everything the caller owns as one jsonb: one entry per table that has an owner_id column (a test checks the list
-- against the migrations), at most 5000 rows per table. A table that had more rows is named in "_truncated"
-- ({"plan_items": true}); the object is empty when nothing was cut. Tombstones are exported without owner_id.
-- Volatile on purpose (no "stable"): it reads many tables and its result must never be cached or reused by the planner.
create or replace function public.core_export_my_data()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb := '{}'::jsonb;
  v_cut jsonb := '{}'::jsonb;
  v_rows jsonb;
  v_more boolean;
  t text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  for t in select unnest(array[
    'core_profiles', 'core_settings', 'core_consents',
    'plan_visit_plans', 'plan_items', 'plan_support_cards', 'plan_support_items', 'plan_support_top_questions',
    'practice_sessions', 'practice_turns', 'practice_item_outcomes',
    'recap_recaps', 'recap_transcript_lines', 'recap_items', 'recap_unconfirmed_items', 'recap_plan_status',
    'persona_facts', 'persona_removed'
  ]) loop
    -- t comes from the fixed list above, never from the caller
    execute format($f$
      with src as (select * from public.%I where owner_id = $1 limit 5001),
           numbered as (select case when %L = 'persona_removed' then to_jsonb(src) - 'owner_id' else to_jsonb(src) end as j,
                               row_number() over () as rn from src)
      select coalesce(jsonb_agg(j) filter (where rn <= 5000), '[]'::jsonb), coalesce(bool_or(rn > 5000), false) from numbered$f$, t, t)
      into v_rows, v_more using v_uid;
    v_out := v_out || jsonb_build_object(t, v_rows);
    if v_more then v_cut := v_cut || jsonb_build_object(t, true); end if;
  end loop;
  return v_out || jsonb_build_object('_truncated', v_cut);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Sign-up can never be blocked by our own trigger. A failure is recorded (code and SQLSTATE only) and the user is
--    created anyway; core_ensure_my_rows() creates the missing rows later.
-- ---------------------------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.core_profiles (owner_id) values (new.id) on conflict do nothing;
    insert into public.core_settings (owner_id) values (new.id) on conflict do nothing;
  exception when others then
    perform private.log_db_event('auth', 'signup_trigger_failed', sqlstate);
  end;
  return new;
end $$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. AI usage: one prune with a floor, and the atomic quota
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_prune_ai_usage(p_keep_days integer default 7)
returns bigint language plpgsql set search_path = '' as $$
declare v_deleted bigint;
begin
  if p_keep_days is null or p_keep_days < 1 then
    raise exception 'p_keep_days must be at least 1' using errcode = '22023'; end if;   -- 0 would wipe today's counters
  delete from public.ops_ai_usage_daily where day < (now() at time zone 'utc')::date - p_keep_days;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- All-or-nothing daily quota over 1 to 4 buckets, safe under concurrency. The function sorts the buckets itself (byte
-- order), so two callers can never take the same locks in opposite order (no deadlock), then locks each bucket for the
-- rest of the transaction. If ANY bucket is already at its limit nothing is counted and false is returned; otherwise
-- every bucket is counted once (shard 0: these buckets are low-contention; the 'global' cost bucket keeps using
-- ops_bump_ai_usage with its 16 shards). Bucket format: global | [c:](u|ip):<8-32 lowercase hex> (what lib/ai/limits.ts sends).
-- SQLSTATE 22023 for bad arguments, 55P03 if a lock is not free within 2 s (the caller falls back to its own counter).
-- SECURITY INVOKER on purpose: it only needs the table rights service_role already has; a definer function would be
-- a way around RLS for no gain. Advisory locks need no privilege.
create or replace function public.ops_take_ai_quota(p_buckets text[], p_limits integer[])
returns boolean language plpgsql security invoker set search_path = '' set lock_timeout = '2s' as $$
declare
  v_day  date := (now() at time zone 'utc')::date;
  n      integer := coalesce(cardinality(p_buckets), 0);
  v_used bigint;
  v_b    text[];
  v_l    integer[];
begin
  if n < 1 or n > 4 or n <> coalesce(cardinality(p_limits), 0) then
    raise exception 'buckets and limits must be 1 to 4 entries each, same length' using errcode = '22023'; end if;
  if (select count(distinct b) from unnest(p_buckets) b) <> n then
    raise exception 'duplicate bucket' using errcode = '22023'; end if;
  for i in 1..n loop
    if p_buckets[i] is null or p_buckets[i] !~ '^(global|(c:)?(u|ip):[0-9a-f]{8,32})$' then
      raise exception 'bucket has the wrong format' using errcode = '22023'; end if;
    if p_limits[i] is null or p_limits[i] <= 0 then
      raise exception 'limit must be greater than 0' using errcode = '22023'; end if;
  end loop;

  select array_agg(x.b order by x.b collate "C"), array_agg(x.l order by x.b collate "C")
    into v_b, v_l from unnest(p_buckets, p_limits) as x(b, l);
  for i in 1..n loop
    perform pg_advisory_xact_lock(hashtext(v_day::text), hashtext(v_b[i]));
  end loop;
  for i in 1..n loop
    select coalesce(sum(u.calls), 0) into v_used from public.ops_ai_usage_daily u
    where u.day = v_day and u.bucket = v_b[i];
    if v_used >= v_l[i] then return false; end if;
  end loop;
  for i in 1..n loop
    insert into public.ops_ai_usage_daily as u (day, bucket, shard, calls)
    values (v_day, v_b[i], 0, 1)
    on conflict (day, bucket, shard) do update set calls = u.calls + 1, updated_at = now();
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 10. Maintenance. FIVE independent steps, each its own pg_cron job (file E) and so its own transaction: a failing or
--     slow step cannot stop the others. All are SECURITY DEFINER owned by postgres (they create/drop partitions and
--     delete auth users); each pins lock_timeout = 5s, takes a transaction-level advisory lock so a manual run cannot race
--     the cron run, logs a failure as maintenance_failed (step + SQLSTATE) and success as maintenance_ok (step:count).
--     Logging never raises. statement_timeout cannot be pinned inside a function (the timer of the calling statement is
--     already running), so the cron commands in file E start with `set statement_timeout`; a manual run of a step should
--     do the same:  set statement_timeout = '10min'; select public.ops_maint_anon_purge();
-- ---------------------------------------------------------------------------------------------
-- Anonymous users with no sign-in, session refresh or content change for 60 days, oldest rule first. Used by the purge
-- and by the alert snapshot (backlog). "Activity" is the latest of: last sign-in, session refresh/update, settings,
-- plans, practice sessions, recaps, persona facts.
create or replace function private.anon_purge_candidate_ids(p_limit integer)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select u.id
  from auth.users u
  where u.is_anonymous
    and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '60 days'
    and not exists (select 1 from auth.sessions s where s.user_id = u.id
                    and greatest(s.refreshed_at, s.updated_at, s.created_at) >= now() - interval '60 days')
    and not exists (select 1 from public.core_settings x where x.owner_id = u.id and x.updated_at >= now() - interval '60 days')
    and not exists (select 1 from public.plan_visit_plans x where x.owner_id = u.id and x.updated_at >= now() - interval '60 days')
    and not exists (select 1 from public.practice_sessions x where x.owner_id = u.id and x.updated_at >= now() - interval '60 days')
    and not exists (select 1 from public.recap_recaps x where x.owner_id = u.id and x.created_at >= now() - interval '60 days')
    and not exists (select 1 from public.persona_facts x where x.owner_id = u.id and x.updated_at >= now() - interval '60 days')
  limit p_limit
$$;
revoke execute on function private.anon_purge_candidate_ids(integer) from public, anon, authenticated;

create or replace function public.ops_maint_partitions()
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_m date; v_created integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('rumi_maint'), hashtext('partitions')) then
    perform private.log_db_event('db', 'maintenance_skipped_locked', 'partitions');
    return jsonb_build_object('skipped', true);
  end if;
  begin
    for i in 0..4 loop   -- this month and four ahead, for both event tables
      v_m := (date_trunc('month', now()) + make_interval(months => i))::date;
      if to_regclass('public.ops_ai_events_' || to_char(v_m, 'YYYY_MM')) is null then v_created := v_created + 1; end if;
      if to_regclass('public.ops_app_events_' || to_char(v_m, 'YYYY_MM')) is null then v_created := v_created + 1; end if;
      perform public.ops_create_ai_event_partition(v_m);
      perform public.ops_create_app_event_partition(v_m);
    end loop;
    perform private.log_db_event('db', 'maintenance_ok', 'partitions:' || v_created);
  exception when others then
    perform private.log_db_event('db', 'maintenance_failed', 'partitions:' || sqlstate);
  end;
  return jsonb_build_object('created_partitions', v_created);
end $$;

create or replace function public.ops_maint_retention()
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare r record; v_dropped text[] := array[]::text[];
begin
  if not pg_try_advisory_xact_lock(hashtext('rumi_maint'), hashtext('retention')) then
    perform private.log_db_event('db', 'maintenance_skipped_locked', 'retention');
    return jsonb_build_object('skipped', true);
  end if;
  begin
    for r in   -- monthly partitions whose whole month is older than 90 days
      select c.relname
      from pg_catalog.pg_inherits inh
      join pg_catalog.pg_class c on c.oid = inh.inhrelid
      join pg_catalog.pg_class p on p.oid = inh.inhparent
      join pg_catalog.pg_namespace n on n.oid = p.relnamespace
      where n.nspname = 'public' and p.relname in ('ops_ai_events', 'ops_app_events')
        and c.relname ~ '_[0-9]{4}_[0-9]{2}$'
        and (to_date(right(c.relname, 7), 'YYYY_MM') + interval '1 month') <= now() - interval '90 days'
    loop
      execute format('drop table if exists public.%I', r.relname);
      v_dropped := v_dropped || r.relname;
    end loop;
    perform private.log_db_event('db', 'maintenance_ok', 'retention:' || cardinality(v_dropped));
  exception when others then
    perform private.log_db_event('db', 'maintenance_failed', 'retention:' || sqlstate);
  end;
  return jsonb_build_object('dropped_partitions', to_jsonb(v_dropped));
end $$;

create or replace function public.ops_maint_prune()
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_usage bigint := 0; v_tomb bigint := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('rumi_maint'), hashtext('prune')) then
    perform private.log_db_event('db', 'maintenance_skipped_locked', 'prune');
    return jsonb_build_object('skipped', true);
  end if;
  begin   -- usage counters older than 7 days
    v_usage := public.ops_prune_ai_usage(7);
  exception when others then
    perform private.log_db_event('db', 'maintenance_failed', 'usage:' || sqlstate);
  end;
  begin   -- tombstones older than 30 days (a device offline for longer than that may re-add a removed fact)
    delete from public.persona_removed where removed_at < now() - interval '30 days';
    get diagnostics v_tomb = row_count;
  exception when others then
    perform private.log_db_event('db', 'maintenance_failed', 'tombstones:' || sqlstate);
  end;
  perform private.log_db_event('db', 'maintenance_ok', 'prune:' || (v_usage + v_tomb));
  return jsonb_build_object('pruned_usage_rows', v_usage, 'pruned_tombstones', v_tomb);
end $$;

-- Deletes up to 2000 inactive anonymous users per run (cascades to every owner table) ONLY when the flag
-- anon_purge_enabled is true. With the flag off (the default) it deletes nothing and logs anon_purge_dry_run with
-- would_delete:<count> so an operator can look before arming it.
create or replace function public.ops_maint_anon_purge()
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_on boolean; v_ids uuid[]; v_n bigint := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('rumi_maint'), hashtext('anon_purge')) then
    perform private.log_db_event('db', 'maintenance_skipped_locked', 'anon_purge');
    return jsonb_build_object('skipped', true);
  end if;
  begin
    v_on := coalesce((select f.enabled from public.ops_feature_flags f where f.key = 'anon_purge_enabled'), false);
    if v_on then
      v_ids := array(select private.anon_purge_candidate_ids(2000));
      delete from auth.users where id = any (v_ids);
      get diagnostics v_n = row_count;
      perform private.log_db_event('db', 'maintenance_ok', 'anon_purge:' || v_n);
      return jsonb_build_object('purged_anonymous_users', v_n, 'enabled', true);
    end if;
    v_n := (select count(*) from private.anon_purge_candidate_ids(100000));
    perform private.log_db_event('db', 'anon_purge_dry_run', 'would_delete:' || v_n);
    return jsonb_build_object('would_delete', v_n, 'enabled', false);
  exception when others then
    perform private.log_db_event('db', 'maintenance_failed', 'anon_purge:' || sqlstate);
    return jsonb_build_object('failed', true);
  end;
end $$;

-- Rows in a default partition mean a month had no partition: report it, never ignore it.
create or replace function public.ops_maint_health()
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare r record; v_bad integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('rumi_maint'), hashtext('health')) then
    perform private.log_db_event('db', 'maintenance_skipped_locked', 'health');
    return jsonb_build_object('skipped', true);
  end if;
  begin
    for r in select 'ops_ai_events' as t, exists (select 1 from public.ops_ai_events_default) as nonempty
             union all select 'ops_app_events', exists (select 1 from public.ops_app_events_default) loop
      if r.nonempty then
        v_bad := v_bad + 1;
        perform private.log_db_event('db', 'default_partition_rows', r.t);
      end if;
    end loop;
    perform private.log_db_event('db', 'maintenance_ok', 'health:' || v_bad);
  exception when others then
    perform private.log_db_event('db', 'maintenance_failed', 'health:' || sqlstate);
  end;
  return jsonb_build_object('default_partitions_with_rows', v_bad);
end $$;

-- Manual convenience: all five steps in order (cron runs them as five separate jobs).
create or replace function public.ops_maintenance_daily()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'partitions', public.ops_maint_partitions(), 'retention', public.ops_maint_retention(), 'prune', public.ops_maint_prune(),
    'anon_purge', public.ops_maint_anon_purge(), 'health', public.ops_maint_health());
$$;

-- ---------------------------------------------------------------------------------------------
-- 11. Grants (explicit; everything defaults to no access)
-- ---------------------------------------------------------------------------------------------
-- Partition creation needs table-creating rights service_role does not have: only the definer jobs call these.
revoke execute on function public.ops_create_month_partition(text, date) from public, anon, authenticated, service_role;
revoke execute on function public.ops_create_app_event_partition(date)   from public, anon, authenticated, service_role;
revoke execute on function public.ops_create_ai_event_partition(date)    from public, anon, authenticated, service_role;

revoke execute on function public.ops_log_app_event(text, text, text, text, text, text, smallint) from public, anon, authenticated;
revoke execute on function public.ops_prune_ai_usage(integer)         from public, anon, authenticated;
revoke execute on function public.ops_take_ai_quota(text[], integer[]) from public, anon, authenticated;
revoke execute on function public.ops_maint_partitions()   from public, anon, authenticated;
revoke execute on function public.ops_maint_retention()    from public, anon, authenticated;
revoke execute on function public.ops_maint_prune()        from public, anon, authenticated;
revoke execute on function public.ops_maint_anon_purge()   from public, anon, authenticated;
revoke execute on function public.ops_maint_health()       from public, anon, authenticated;
revoke execute on function public.ops_maintenance_daily()  from public, anon, authenticated;
grant  execute on function public.ops_log_app_event(text, text, text, text, text, text, smallint) to service_role;
grant  execute on function public.ops_prune_ai_usage(integer)         to service_role;
grant  execute on function public.ops_take_ai_quota(text[], integer[]) to service_role;
grant  execute on function public.ops_maint_partitions()   to service_role;
grant  execute on function public.ops_maint_retention()    to service_role;
grant  execute on function public.ops_maint_prune()        to service_role;
grant  execute on function public.ops_maint_anon_purge()   to service_role;
grant  execute on function public.ops_maint_health()       to service_role;
grant  execute on function public.ops_maintenance_daily()  to service_role;

revoke execute on function public.persona_upsert_facts(jsonb) from public, anon;
revoke execute on function public.persona_forget_all()        from public, anon;
revoke execute on function public.core_ensure_my_rows()       from public, anon;
revoke execute on function public.core_export_my_data()       from public, anon;
revoke execute on function public.core_delete_my_data()       from public, anon;
grant  execute on function public.persona_upsert_facts(jsonb) to authenticated;
grant  execute on function public.persona_forget_all()        to authenticated;
grant  execute on function public.core_ensure_my_rows()       to authenticated;
grant  execute on function public.core_export_my_data()       to authenticated;
grant  execute on function public.core_delete_my_data()       to authenticated;

comment on function public.persona_upsert_facts(jsonb) is '[PERSONA] Batch upsert of up to 100 facts (54000 above), at most 200 facts per person (54000), last write wins by client_updated_at (clamped to now + 5 min, must be finite). Needs persona_memory consent (RLS). Returns rows written.';
comment on function public.persona_forget_all() is '[PERSONA] Erase all of the caller''s facts and tombstones. Returns facts remaining (must be 0).';
comment on function public.core_ensure_my_rows() is '[CORE] Create the caller''s missing profile and settings rows (self-heal if the sign-up trigger failed).';
comment on function public.core_export_my_data() is '[CORE] All of the caller''s rows from every owner table as one JSON object keyed by table name, max 5000 rows per table, "_truncated" names cut tables; tombstones without owner_id.';
comment on function public.ops_take_ai_quota(text[], integer[]) is '[OPS][SERVICE-ONLY] All-or-nothing daily quota over 1-4 buckets (sorted internally). Returns false (nothing counted) if any bucket is at its limit.';
comment on function public.ops_maintenance_daily() is '[OPS] Runs the five maintenance steps in order and returns their summaries. Cron runs the steps as separate jobs.';
