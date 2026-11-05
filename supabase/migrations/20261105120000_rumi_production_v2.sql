-- Rumi schema v2 (production hardening). Forward-only, additive, expand/contract.
--
-- What this adds on top of v1 (nothing is dropped except two superseded CHECK constraints,
-- each replaced by a new one that is validated first):
--   1. ops_feature_flags          kill switches, service_role only
--   2. ops_app_events             app/db error events, monthly partitions, service_role only
--   3. ops_ai_events              wider outcome list, cache_status, cached_tokens
--   4. persona_facts              3 kinds, client_updated_at, batch upsert, total erase
--   5. core_ensure_my_rows / core_export_my_data
--   6. handle_new_user            can never block a sign-up
--   7. role timeouts              anon, authenticated
--   8. ops_maintenance_daily      partitions, retention, anonymous-user purge, pg_cron schedule
--
-- ROLLBACK: this file is applied in one transaction. If any statement fails, nothing is kept
-- (drilled by scripts/db/rollback-drill.sh). To undo a successful apply, ship a forward migration.
-- Every function sets search_path = '' and has explicit grants. Ops tables: RLS on, no policy.

-- ---------------------------------------------------------------------------------------------
-- 1. Feature flags (kill switches). service_role only: users never read or write them.
-- ---------------------------------------------------------------------------------------------
create table public.ops_feature_flags (
  key        text primary key check (key ~ '^[a-z_]{1,40}$'),
  enabled    boolean not null,
  updated_at timestamptz not null default now()
);
alter table public.ops_feature_flags enable row level security;
revoke all on public.ops_feature_flags from public, anon, authenticated;
grant all on public.ops_feature_flags to service_role;
create trigger ops_feature_flags_touch before update on public.ops_feature_flags
  for each row execute function private.touch_updated_at();

insert into public.ops_feature_flags (key, enabled) values
  ('ai_enabled', true), ('memory_sync_enabled', true), ('cloud_sync_enabled', true)
on conflict (key) do nothing;

comment on table public.ops_feature_flags is '[OPS][SERVICE-ONLY] Kill switches read by the server (cached 30 s). Flip with: update public.ops_feature_flags set enabled = false where key = ''ai_enabled'';';

-- ---------------------------------------------------------------------------------------------
-- 2. App events: errors and notable events from server, client and database. No text, no user id.
-- ---------------------------------------------------------------------------------------------
create sequence public.ops_app_events_id_seq;

create table public.ops_app_events (
  id          bigint not null default nextval('public.ops_app_events_id_seq'),
  created_at  timestamptz not null default now(),
  source      text not null check (source in ('server', 'client', 'db')),
  area        text not null check (area in ('auth', 'db', 'ai', 'memory', 'app', 'sync')),
  code        text not null check (char_length(code) <= 60 and code ~ '^[a-z0-9_.:-]+$'),
  fingerprint text check (char_length(fingerprint) <= 64),
  route       text check (char_length(route) <= 80),
  release     text check (char_length(release) <= 40),
  status      smallint,
  primary key (created_at, id)
) partition by range (created_at);
alter sequence public.ops_app_events_id_seq owned by public.ops_app_events.id;
create index ops_app_events_area_created_idx on public.ops_app_events (area, created_at desc);

-- One function creates a monthly partition of either event table. If rows for that month already
-- landed in the default partition (a cron outage), they are moved first, so creation never fails
-- with "default partition would be violated".
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
  if to_regclass(format('public.%I', v_name)) is not null then return; end if;

  execute format('create table public.%I (like public.%I including all)', v_name, p_parent);
  execute format(
    'with moved as (delete from public.%I where created_at >= %L and created_at < %L returning *) insert into public.%I select * from moved',
    p_parent || '_default', v_start, v_end, v_name);
  execute format('alter table public.%I attach partition public.%I for values from (%L) to (%L)',
                 p_parent, v_name, v_start, v_end);
  execute format('alter table public.%I enable row level security', v_name);
  execute format('revoke all on public.%I from public, anon, authenticated', v_name);
end $$;

create or replace function public.ops_create_ai_event_partition(p_month date)
returns void language sql set search_path = '' as $$
  select public.ops_create_month_partition('ops_ai_events', p_month);
$$;

create or replace function public.ops_create_app_event_partition(p_month date)
returns void language sql set search_path = '' as $$
  select public.ops_create_month_partition('ops_app_events', p_month);
$$;

create table public.ops_app_events_default partition of public.ops_app_events default;
select public.ops_create_app_event_partition(d::date)
from generate_series('2026-11-01'::date, '2027-04-01'::date, interval '1 month') as d;

alter table public.ops_app_events enable row level security;
alter table public.ops_app_events_default enable row level security;
revoke all on public.ops_app_events, public.ops_app_events_default from public, anon, authenticated;
grant all on public.ops_app_events, public.ops_app_events_default to service_role;
revoke all on sequence public.ops_app_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.ops_app_events_id_seq to service_role;

create or replace function public.ops_log_app_event(
  p_source text, p_area text, p_code text, p_fingerprint text,
  p_route text, p_release text, p_status smallint)
returns void language sql set search_path = '' as $$
  insert into public.ops_app_events (source, area, code, fingerprint, route, release, status)
  values (p_source, p_area, p_code, p_fingerprint, p_route, p_release, p_status);
$$;

comment on table public.ops_app_events is '[OPS][SERVICE-ONLY] App and database error events, partitioned by month, kept 90 days. Code, fingerprint, route, release. Never text, never a user id.';
comment on table public.ops_app_events_default is '[OPS][SERVICE-ONLY] Catch-all partition. Should stay empty: ops_maintenance_daily() creates the next months ahead of time.';

-- ---------------------------------------------------------------------------------------------
-- 3. ops_ai_events: more outcomes, cache columns. New CHECK first (NOT VALID, then VALIDATE),
--    only then the superseded one is dropped, so there is never a moment without a check.
-- ---------------------------------------------------------------------------------------------
alter table public.ops_ai_events add constraint ops_ai_events_outcome_v2_check
  check (outcome in ('ok', 'degraded', 'crisis', 'rate_limited', 'invalid_input', 'provider_error',
                     'guard_blocked', 'unauthorized', 'timeout', 'config_error')) not valid;
alter table public.ops_ai_events validate constraint ops_ai_events_outcome_v2_check;
alter table public.ops_ai_events drop constraint ops_ai_events_outcome_check;

alter table public.ops_ai_events
  add column cache_status text check (cache_status in ('miss', 'hit', 'bypass')),
  add column cached_tokens integer check (cached_tokens >= 0);

-- ---------------------------------------------------------------------------------------------
-- 4. Persona: 3 kinds, device timestamp, batch upsert, total erase
-- ---------------------------------------------------------------------------------------------
alter table public.persona_facts add constraint persona_facts_kind_v2_check
  check (kind in ('support_pref', 'pacing', 'help_level')) not valid;   -- blocks new focus_pref rows now
delete from public.persona_facts where kind = 'focus_pref';             -- retired kind (Supermemory era), nothing reads it
alter table public.persona_facts validate constraint persona_facts_kind_v2_check;
alter table public.persona_facts drop constraint persona_facts_kind_check;

-- Constant-time add on PG 11+ (now() is stable, so no table rewrite).
alter table public.persona_facts add column client_updated_at timestamptz not null default now();

-- Batch, idempotent, last-write-wins by the device timestamp. Runs as the caller: RLS enforces
-- ownership and the persona_memory consent. Returns the number of rows inserted or changed.
create or replace function public.persona_upsert_facts(p_facts jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_written integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    raise exception 'facts must be a json array' using errcode = '22023'; end if;
  if jsonb_array_length(p_facts) > 100 then
    raise exception 'too many facts (max 100)' using errcode = '54000'; end if;

  insert into public.persona_facts as f (owner_id, kind, key, level, client_updated_at)
  select v_uid, b.kind, b.key, b.level, b.client_updated_at
  from (
    -- one row per (kind, key) in the batch: the newest wins, so ON CONFLICT never sees a key twice
    select distinct on (x.kind, x.key)
           x.kind, x.key, x.level, coalesce(x.client_updated_at, now()) as client_updated_at
    from jsonb_to_recordset(p_facts) as x(kind text, key text, level smallint, client_updated_at timestamptz)
    order by x.kind, x.key, coalesce(x.client_updated_at, now()) desc
  ) b
  on conflict (owner_id, kind, key) do update
    set level = excluded.level, client_updated_at = excluded.client_updated_at
    where excluded.client_updated_at > f.client_updated_at;
  get diagnostics v_written = row_count;
  return v_written;
end $$;

-- Deletes every fact of the caller and returns how many are left (must be 0).
create or replace function public.persona_forget_all()
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  delete from public.persona_facts where owner_id = v_uid;
  return (select count(*)::integer from public.persona_facts where owner_id = v_uid);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Self-heal and export (security invoker: RLS applies, the caller only ever sees own rows)
-- ---------------------------------------------------------------------------------------------
create or replace function public.core_ensure_my_rows()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  insert into public.core_profiles (owner_id) values (v_uid) on conflict do nothing;
  insert into public.core_settings (owner_id) values (v_uid) on conflict do nothing;
end $$;

create or replace function public.core_export_my_data()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb := '{}'::jsonb;
  v_rows jsonb;
  t text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  for t in select unnest(array[
    'core_profiles', 'core_settings', 'core_consents',
    'plan_visit_plans', 'plan_items', 'plan_support_cards', 'plan_support_items', 'plan_support_top_questions',
    'practice_sessions', 'practice_turns', 'practice_item_outcomes',
    'recap_recaps', 'recap_transcript_lines', 'recap_items', 'recap_unconfirmed_items', 'recap_plan_status',
    'persona_facts'
  ]) loop
    -- t comes from the fixed list above, never from the caller
    execute format('select coalesce(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) from public.%I r where r.owner_id = $1', t)
      into v_rows using v_uid;
    v_out := v_out || jsonb_build_object(t, v_rows);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 6. Sign-up can never be blocked by our own trigger. A failure is recorded (code and SQLSTATE
--    only) and the user is created anyway; core_ensure_my_rows() creates the missing rows later.
-- ---------------------------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.core_profiles (owner_id) values (new.id) on conflict do nothing;
    insert into public.core_settings (owner_id) values (new.id) on conflict do nothing;
  exception when others then
    begin
      insert into public.ops_app_events (source, area, code, fingerprint)
      values ('db', 'auth', 'signup_trigger_failed', sqlstate);
    exception when others then
      -- Logging the failure must not block sign-up either; core_ensure_my_rows() heals the rows.
      null;
    end;
  end;
  return new;
end $$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. Role timeouts. PostgREST applies the settings of the request role to every request.
--    The migration owner and service_role are not affected (maintenance may run longer).
-- ---------------------------------------------------------------------------------------------
alter role anon set statement_timeout = '8s';
alter role anon set idle_in_transaction_session_timeout = '30s';
alter role anon set lock_timeout = '5s';
alter role authenticated set statement_timeout = '8s';
alter role authenticated set idle_in_transaction_session_timeout = '30s';
alter role authenticated set lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------
-- 8. Daily maintenance (pg_cron, 03:17 UTC). Each step is isolated: a failure is recorded as an
--    ops_app_events row (step name + SQLSTATE) and the other steps still run.
-- ---------------------------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.ops_maintenance_daily()
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_out     jsonb := '{}'::jsonb;
  v_n       bigint;
  v_dropped text[] := array[]::text[];
  r         record;
begin
  -- a) current month and the next two, for both event tables
  begin
    for i in 0..2 loop
      perform public.ops_create_ai_event_partition((date_trunc('month', now()) + make_interval(months => i))::date);
      perform public.ops_create_app_event_partition((date_trunc('month', now()) + make_interval(months => i))::date);
    end loop;
  exception when others then
    insert into public.ops_app_events (source, area, code, fingerprint) values ('db', 'db', 'maintenance_failed', 'partitions:' || sqlstate);
  end;

  -- b) drop monthly partitions whose whole month is older than 90 days
  begin
    for r in
      select c.relname
      from pg_catalog.pg_inherits inh
      join pg_catalog.pg_class c on c.oid = inh.inhrelid
      join pg_catalog.pg_class p on p.oid = inh.inhparent
      join pg_catalog.pg_namespace n on n.oid = p.relnamespace
      where n.nspname = 'public' and p.relname in ('ops_ai_events', 'ops_app_events')
        and c.relname ~ '_[0-9]{4}_[0-9]{2}$'
        and (to_date(right(c.relname, 7), 'YYYY_MM') + interval '1 month') <= now() - interval '90 days'
    loop
      execute format('drop table public.%I', r.relname);
      v_dropped := v_dropped || r.relname;
    end loop;
  exception when others then
    insert into public.ops_app_events (source, area, code, fingerprint) values ('db', 'db', 'maintenance_failed', 'retention:' || sqlstate);
  end;
  v_out := v_out || jsonb_build_object('dropped_partitions', to_jsonb(v_dropped));

  -- c) usage counters older than 7 days
  begin
    v_out := v_out || jsonb_build_object('pruned_usage_rows', public.ops_prune_ai_usage(7));
  exception when others then
    insert into public.ops_app_events (source, area, code, fingerprint) values ('db', 'db', 'maintenance_failed', 'usage:' || sqlstate);
  end;

  -- d) anonymous users inactive for 60 days (cascades to every owner table).
  --    At most 10000 per run so one run stays short; a larger backlog clears over the next days.
  begin
    delete from auth.users
    where id in (
      select u.id from auth.users u
      where u.is_anonymous and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '60 days'
      limit 10000);
    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('purged_anonymous_users', v_n);
  exception when others then
    insert into public.ops_app_events (source, area, code, fingerprint) values ('db', 'db', 'maintenance_failed', 'anon_purge:' || sqlstate);
  end;

  -- e) rows in a default partition mean a month had no partition: report it, never ignore it
  for r in select 'ops_ai_events' as t, exists (select 1 from public.ops_ai_events_default) as nonempty
           union all select 'ops_app_events', exists (select 1 from public.ops_app_events_default) loop
    if r.nonempty then
      insert into public.ops_app_events (source, area, code, fingerprint) values ('db', 'db', 'default_partition_rows', r.t);
    end if;
  end loop;
  return v_out;
end $$;

select cron.schedule('rumi-ops-maintenance-daily', '17 3 * * *', 'select public.ops_maintenance_daily()');

-- ---------------------------------------------------------------------------------------------
-- 9. Grants (explicit; everything defaults to no access)
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.ops_create_month_partition(text, date) from public, anon, authenticated;
revoke execute on function public.ops_create_app_event_partition(date)   from public, anon, authenticated;
revoke execute on function public.ops_create_ai_event_partition(date)    from public, anon, authenticated;
revoke execute on function public.ops_log_app_event(text, text, text, text, text, text, smallint) from public, anon, authenticated;
revoke execute on function public.ops_maintenance_daily()                from public, anon, authenticated;
grant  execute on function public.ops_create_month_partition(text, date) to service_role;
grant  execute on function public.ops_create_app_event_partition(date)   to service_role;
grant  execute on function public.ops_create_ai_event_partition(date)    to service_role;
grant  execute on function public.ops_log_app_event(text, text, text, text, text, text, smallint) to service_role;
grant  execute on function public.ops_maintenance_daily()                to service_role;

revoke execute on function public.persona_upsert_facts(jsonb) from public, anon;
revoke execute on function public.persona_forget_all()        from public, anon;
revoke execute on function public.core_ensure_my_rows()       from public, anon;
revoke execute on function public.core_export_my_data()       from public, anon;
grant  execute on function public.persona_upsert_facts(jsonb) to authenticated;
grant  execute on function public.persona_forget_all()        to authenticated;
grant  execute on function public.core_ensure_my_rows()       to authenticated;
grant  execute on function public.core_export_my_data()       to authenticated;

comment on function public.persona_upsert_facts(jsonb) is '[PERSONA] Batch upsert of up to 100 facts, last write wins by client_updated_at. Needs persona_memory consent (RLS). Returns rows written.';
comment on function public.persona_forget_all() is '[PERSONA] Erase all of the caller''s facts. Returns facts remaining (must be 0).';
comment on function public.core_ensure_my_rows() is '[CORE] Create the caller''s missing profile and settings rows (self-heal if the sign-up trigger failed).';
comment on function public.core_export_my_data() is '[CORE] All of the caller''s rows from every owner table as one JSON object keyed by table name.';
comment on function public.ops_maintenance_daily() is '[OPS] Daily job (pg_cron 03:17 UTC): partitions ahead, 90-day event retention, usage prune, anonymous-user purge. Returns a summary.';
