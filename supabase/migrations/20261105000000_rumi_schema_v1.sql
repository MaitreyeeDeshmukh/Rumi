-- Rumi schema v1
--
-- NAMING: every table starts with a group prefix so the groups are obvious in the dashboard.
--   core_      account, settings, consent            [USER-PRIVATE]
--   plan_      visit plan, support card              [USER-CONTENT]   needs 'cloud_sync' consent to write
--   practice_  practice sessions and turns           [USER-CONTENT]   needs 'cloud_sync' consent to write
--   recap_     visit recap with evidence             [USER-CONTENT]   needs 'cloud_sync' consent to write
--   persona_   short preference facts (no free text) [USER-CONTENT]   needs 'persona_memory' consent to write
--   ops_       usage counters and AI telemetry       [SERVICE-ONLY]   counts only, never user text, no user id
--   research_  tester-session counts                 [SERVICE-ONLY]   no names
--
-- ACCESS MODEL
--   * Users sign in with Supabase Auth (anonymous sign-ins are enough: Rumi has no login screen).
--   * Every user table has owner_id = auth.uid() and RLS ON. Policies are for role `authenticated` only.
--   * `anon` has no access to anything. ops_/research_ tables have RLS ON and no policy: only the
--     server (service_role) can touch them.
--   * Child tables repeat owner_id and use composite foreign keys (id, owner_id), so a row can never
--     point at another user's parent row, and RLS never needs a join.
--
-- SCALE (100k+ users)
--   * policies use (select auth.uid()) so Postgres evaluates it once per query, not per row
--   * owner_id is indexed on every table; every foreign key has a supporting index
--   * high-volume children use bigint identity keys (small indexes); roots use uuid
--   * ops_ai_events is range-partitioned by month; ops_ai_usage_daily spreads one hot row over 16 shards

-- ---------------------------------------------------------------------------------------------
-- 0. Helpers (schema `private` is not exposed through the API)
-- ---------------------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. CORE: account, settings, consent
-- ---------------------------------------------------------------------------------------------
create table public.core_profiles (
  owner_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name   text check (char_length(display_name) between 1 and 40),
  companion_name text not null default 'Rumi' check (char_length(companion_name) between 1 and 30),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.core_settings (
  owner_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  theme          text not null default 'soft'  check (theme in ('soft', 'contrast', 'low')),
  text_scale     numeric(3,2) not null default 1 check (text_scale in (1, 1.15, 1.3, 1.5)),
  reduced_motion boolean not null default false,
  output_mode    text not null default 'both'  check (output_mode in ('read', 'listen', 'both')),
  detail         text not null default 'short' check (detail in ('short', 'detailed')),
  speech_rate    numeric(3,2) not null default 1 check (speech_rate between 0.7 and 1.2),
  finish_sound   boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- One row per consent kind. Content tables check this in their RLS policies.
create table public.core_consents (
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind           text not null check (kind in ('cloud_sync', 'persona_memory', 'research_counts')),
  granted        boolean not null default false,
  policy_version text not null check (char_length(policy_version) between 1 and 40),
  granted_at     timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (owner_id, kind)
);

create or replace function private.has_consent(p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.granted from public.core_consents c
      where c.owner_id = (select auth.uid()) and c.kind = p_kind),
    false)
$$;
revoke execute on function private.has_consent(text) from public, anon;
grant execute on function private.has_consent(text) to authenticated;

-- New auth user (including anonymous) gets default profile and settings automatically.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.core_profiles (owner_id) values (new.id) on conflict do nothing;
  insert into public.core_settings (owner_id) values (new.id) on conflict do nothing;
  return new;
end $$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- 2. PLAN: visit plan and support card
-- ---------------------------------------------------------------------------------------------
create table public.plan_visit_plans (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title                text not null default '' check (char_length(title) <= 80),
  main_concern         text not null default '' check (char_length(main_concern) <= 300),
  symptoms_in_my_words text[] not null default '{}' check (cardinality(symptoms_in_my_words) <= 12),
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, owner_id)
);
create index plan_visit_plans_owner_created_idx on public.plan_visit_plans (owner_id, created_at desc);
-- At most one current (not archived) plan per user.
create unique index plan_visit_plans_one_current_idx on public.plan_visit_plans (owner_id) where archived_at is null;

create table public.plan_items (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id    uuid not null,
  position   smallint not null check (position between 0 and 11),
  local_id   text not null check (char_length(local_id) between 1 and 40),
  text       text not null check (char_length(text) between 1 and 200),
  kind       text not null check (kind in ('concern', 'question', 'accommodation')),
  source     text not null check (source in ('user', 'suggested')),
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, position),
  unique (plan_id, local_id),
  unique (id, owner_id),
  foreign key (plan_id, owner_id) references public.plan_visit_plans (id, owner_id) on delete cascade
);
create index plan_items_owner_idx on public.plan_items (owner_id);

create table public.plan_support_cards (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id    uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id),
  unique (id, owner_id),
  foreign key (plan_id, owner_id) references public.plan_visit_plans (id, owner_id) on delete cascade
);
create index plan_support_cards_owner_idx on public.plan_support_cards (owner_id);

create table public.plan_support_items (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id    uuid not null,
  position   smallint not null check (position between 0 and 19),
  preset_key text check (char_length(preset_key) between 1 and 60),
  text       text not null check (char_length(text) between 1 and 140),
  source     text not null check (source in ('preset', 'user')),
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source <> 'preset' or preset_key is not null),
  unique (card_id, position),
  foreign key (card_id, owner_id) references public.plan_support_cards (id, owner_id) on delete cascade
);
create index plan_support_items_owner_idx on public.plan_support_items (owner_id);

-- "Pick up to 2 questions to bring": position 1 or 2 enforces the limit.
create table public.plan_support_top_questions (
  card_id      uuid not null,
  position     smallint not null check (position in (1, 2)),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_item_id bigint not null,
  primary key (card_id, position),
  unique (card_id, plan_item_id),
  foreign key (card_id, owner_id) references public.plan_support_cards (id, owner_id) on delete cascade,
  foreign key (plan_item_id, owner_id) references public.plan_items (id, owner_id) on delete cascade
);
create index plan_support_top_questions_owner_idx on public.plan_support_top_questions (owner_id);
create index plan_support_top_questions_item_idx on public.plan_support_top_questions (plan_item_id);

-- ---------------------------------------------------------------------------------------------
-- 3. PRACTICE: sessions, turns, per-item outcome
-- ---------------------------------------------------------------------------------------------
create table public.practice_sessions (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id      uuid not null,
  focus        text not null check (focus in ('problem', 'questions', 'needs', 'next_steps', 'whole')),
  status       text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  ready_before smallint check (ready_before between 1 and 5),
  ready_after  smallint check (ready_after between 1 and 5),
  help_count   integer not null default 0 check (help_count >= 0),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  unique (id, owner_id),
  foreign key (plan_id, owner_id) references public.plan_visit_plans (id, owner_id) on delete cascade
);
create index practice_sessions_owner_started_idx on public.practice_sessions (owner_id, started_at desc);
create index practice_sessions_plan_idx on public.practice_sessions (plan_id);

create table public.practice_turns (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  turn_index smallint not null check (turn_index between 0 and 39),
  role       text not null check (role in ('clinician', 'me')),
  text       text not null check (char_length(text) between 1 and 600),
  used_help  boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index),
  foreign key (session_id, owner_id) references public.practice_sessions (id, owner_id) on delete cascade
);
create index practice_turns_owner_idx on public.practice_turns (owner_id);

create table public.practice_item_outcomes (
  session_id      uuid not null,
  plan_item_id    bigint not null,
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  covered         boolean not null default false,
  help_level_used smallint not null default 0 check (help_level_used between 0 and 3),
  primary key (session_id, plan_item_id),
  foreign key (session_id, owner_id) references public.practice_sessions (id, owner_id) on delete cascade,
  foreign key (plan_item_id, owner_id) references public.plan_items (id, owner_id) on delete cascade
);
create index practice_item_outcomes_owner_idx on public.practice_item_outcomes (owner_id);
create index practice_item_outcomes_item_idx on public.practice_item_outcomes (plan_item_id);

-- ---------------------------------------------------------------------------------------------
-- 4. RECAP: sample-visit recap, evidence checked
-- ---------------------------------------------------------------------------------------------
create table public.recap_recaps (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plan_id           uuid,
  my_speaker        text not null check (my_speaker in ('A', 'B', 'C', 'D')),
  is_sample         boolean not null default true,
  is_saved_fallback boolean not null default false,
  prompt_version    text check (char_length(prompt_version) <= 40),
  created_at        timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (plan_id, owner_id) references public.plan_visit_plans (id, owner_id) on delete set null (plan_id)
);
create index recap_recaps_owner_created_idx on public.recap_recaps (owner_id, created_at desc);
create index recap_recaps_plan_idx on public.recap_recaps (plan_id);

create table public.recap_transcript_lines (
  id       bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recap_id uuid not null,
  line_no  smallint not null check (line_no between 1 and 60),
  local_id text not null check (char_length(local_id) between 1 and 40),
  speaker  text not null check (speaker in ('A', 'B', 'C', 'D')),
  text     text not null check (char_length(text) between 1 and 400),
  unique (recap_id, line_no),
  unique (recap_id, local_id),
  foreign key (recap_id, owner_id) references public.recap_recaps (id, owner_id) on delete cascade
);
create index recap_transcript_lines_owner_idx on public.recap_transcript_lines (owner_id);

-- Every item must cite 1 to 6 transcript lines (by line_no). Items with no evidence belong in
-- recap_unconfirmed_items, never here.
create table public.recap_items (
  id                bigint generated always as identity primary key,
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recap_id          uuid not null,
  position          smallint not null check (position between 0 and 19),
  section           text not null check (section in ('discussed', 'instructions', 'medications', 'next_steps')),
  text              text not null check (char_length(text) between 1 and 300),
  evidence_line_nos smallint[] not null check (cardinality(evidence_line_nos) between 1 and 6),
  unique (recap_id, position),
  foreign key (recap_id, owner_id) references public.recap_recaps (id, owner_id) on delete cascade
);
create index recap_items_owner_idx on public.recap_items (owner_id);

create table public.recap_unconfirmed_items (
  id       bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recap_id uuid not null,
  position smallint not null check (position between 0 and 9),
  text     text not null check (char_length(text) between 1 and 300),
  unique (recap_id, position),
  foreign key (recap_id, owner_id) references public.recap_recaps (id, owner_id) on delete cascade
);
create index recap_unconfirmed_items_owner_idx on public.recap_unconfirmed_items (owner_id);

-- "What I said myself": for each plan item, who asked it.
create table public.recap_plan_status (
  recap_id          uuid not null,
  plan_item_id      bigint not null,
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status            text not null check (status in ('asked_by_me', 'asked_by_other', 'not_asked', 'unclear')),
  evidence_line_nos smallint[] not null default '{}' check (cardinality(evidence_line_nos) <= 6),
  primary key (recap_id, plan_item_id),
  foreign key (recap_id, owner_id) references public.recap_recaps (id, owner_id) on delete cascade,
  foreign key (plan_item_id, owner_id) references public.plan_items (id, owner_id) on delete cascade
);
create index recap_plan_status_owner_idx on public.recap_plan_status (owner_id);
create index recap_plan_status_item_idx on public.recap_plan_status (plan_item_id);

-- ---------------------------------------------------------------------------------------------
-- 5. PERSONA: short preference facts the USER chose. No free text column on purpose.
-- ---------------------------------------------------------------------------------------------
create table public.persona_facts (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('support_pref', 'pacing', 'help_level', 'focus_pref')),
  key        text not null check (key ~ '^[a-z0-9_:.-]{1,60}$'),
  level      smallint check (level between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'help_level' or level is not null),
  unique (owner_id, kind, key)
);

-- ---------------------------------------------------------------------------------------------
-- 6. OPS: usage limits and AI telemetry. Service role only. Never user text, never a user id.
-- ---------------------------------------------------------------------------------------------
-- bucket: 'global' or 'ip:<hash8>'. shard spreads writes so one hot bucket is not a lock hotspot.
create table public.ops_ai_usage_daily (
  day            date not null,
  bucket         text not null check (char_length(bucket) between 1 and 40),
  shard          smallint not null check (shard between 0 and 15),
  calls          integer not null default 0 check (calls >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  updated_at     timestamptz not null default now(),
  primary key (day, bucket, shard)
);

create sequence public.ops_ai_events_id_seq;

create table public.ops_ai_events (
  id             bigint not null default nextval('public.ops_ai_events_id_seq'),
  created_at     timestamptz not null default now(),
  task           text not null check (task in ('plan', 'practice', 'sayit', 'recap', 'memory', 'stt', 'tts')),
  outcome        text not null check (outcome in ('ok', 'degraded', 'crisis', 'rate_limited', 'invalid_input', 'provider_error', 'guard_blocked')),
  tier           text check (tier in ('quality', 'fast', 'fallback')),
  model          text check (char_length(model) <= 80),
  prompt_version text check (char_length(prompt_version) <= 40),
  attempts       smallint check (attempts between 0 and 5),
  guard_codes    text[] not null default '{}',
  latency_ms     integer check (latency_ms >= 0),
  input_tokens   integer check (input_tokens >= 0),
  output_tokens  integer check (output_tokens >= 0),
  cost_micro_usd integer check (cost_micro_usd >= 0),
  bucket         text check (char_length(bucket) <= 40),
  primary key (created_at, id)
) partition by range (created_at);
alter sequence public.ops_ai_events_id_seq owned by public.ops_ai_events.id;
create index ops_ai_events_task_created_idx on public.ops_ai_events (task, created_at desc);

create or replace function public.ops_create_ai_event_partition(p_month date)
returns void language plpgsql set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_name  text := 'ops_ai_events_' || to_char(v_start, 'YYYY_MM');
begin
  execute format(
    'create table if not exists public.%I partition of public.ops_ai_events for values from (%L) to (%L)',
    v_name, v_start, (v_start + interval '1 month')::date);
  execute format('alter table public.%I enable row level security', v_name);
  execute format('revoke all on public.%I from public, anon, authenticated', v_name);
end $$;

-- Pre-create 6 months. Add more with: select public.ops_create_ai_event_partition('2027-05-01');
select public.ops_create_ai_event_partition(d::date)
from generate_series('2026-11-01'::date, '2027-04-01'::date, interval '1 month') as d;

create table public.ops_ai_events_default partition of public.ops_ai_events default;

create table public.research_tester_sessions (
  id                uuid primary key default gen_random_uuid(),
  session_date      date not null default current_date,
  participant_code  text not null check (participant_code ~ '^[A-Z][0-9]{1,3}$'), -- e.g. T01, never a name
  setting           text check (char_length(setting) <= 60),
  ready_before      smallint check (ready_before between 1 and 5),
  ready_after       smallint check (ready_after between 1 and 5),
  items_total       smallint not null check (items_total >= 0),
  items_unaided     smallint not null check (items_unaided >= 0),
  items_with_help   smallint not null check (items_with_help >= 0),
  confusion_note    text check (char_length(confusion_note) <= 200),
  change_suggestion text check (char_length(change_suggestion) <= 200),
  created_at        timestamptz not null default now(),
  check (items_unaided + items_with_help <= items_total),
  unique (session_date, participant_code)
);

-- ---------------------------------------------------------------------------------------------
-- 7. Functions for the server (service_role only) and for users (Delete everything)
-- ---------------------------------------------------------------------------------------------
create or replace function public.ops_bump_ai_usage(p_bucket text, p_calls integer default 1, p_cost_micro_usd bigint default 0)
returns void language sql set search_path = '' as $$
  insert into public.ops_ai_usage_daily as u (day, bucket, shard, calls, cost_micro_usd)
  values ((now() at time zone 'utc')::date, p_bucket, floor(random() * 16)::smallint, p_calls, p_cost_micro_usd)
  on conflict (day, bucket, shard) do update
    set calls = u.calls + excluded.calls,
        cost_micro_usd = u.cost_micro_usd + excluded.cost_micro_usd,
        updated_at = now();
$$;

create or replace function public.ops_ai_usage_total(p_day date, p_bucket text)
returns table (calls bigint, cost_micro_usd bigint) language sql stable set search_path = '' as $$
  select coalesce(sum(u.calls), 0)::bigint, coalesce(sum(u.cost_micro_usd), 0)::bigint
  from public.ops_ai_usage_daily u
  where u.day = p_day and u.bucket = p_bucket;
$$;

create or replace function public.ops_prune_ai_usage(p_keep_days integer default 7)
returns bigint language plpgsql set search_path = '' as $$
declare v_deleted bigint;
begin
  delete from public.ops_ai_usage_daily where day < (now() at time zone 'utc')::date - p_keep_days;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

-- "Delete everything": removes the caller's content, persona and consents, then resets profile
-- and settings to defaults. Runs as the caller, so RLS still applies. Children go by cascade.
create or replace function public.core_delete_my_data()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  delete from public.recap_recaps where owner_id = v_uid;
  delete from public.plan_visit_plans where owner_id = v_uid;   -- cascades plans, cards, sessions
  delete from public.persona_facts where owner_id = v_uid;
  delete from public.core_consents where owner_id = v_uid;
  update public.core_profiles set display_name = null, companion_name = 'Rumi' where owner_id = v_uid;
  delete from public.core_settings where owner_id = v_uid;
  insert into public.core_settings (owner_id) values (v_uid);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. updated_at triggers
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'core_profiles', 'core_settings', 'core_consents', 'plan_visit_plans', 'plan_items',
    'plan_support_cards', 'plan_support_items', 'practice_sessions', 'persona_facts', 'ops_ai_usage_daily'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
                   t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------------------------------
-- 9a. Enable RLS on EVERY table. Server-only tables get no policy at all (deny by default).
do $$
declare t text;
begin
  foreach t in array array[
    'core_profiles', 'core_settings', 'core_consents',
    'plan_visit_plans', 'plan_items', 'plan_support_cards', 'plan_support_items', 'plan_support_top_questions',
    'practice_sessions', 'practice_turns', 'practice_item_outcomes',
    'recap_recaps', 'recap_transcript_lines', 'recap_items', 'recap_unconfirmed_items', 'recap_plan_status',
    'persona_facts',
    'ops_ai_usage_daily', 'ops_ai_events', 'ops_ai_events_default', 'research_tester_sessions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- 9b. Owner policies. "gate" = the consent that must be on to INSERT or UPDATE.
--     Reading and deleting never need consent, so a user can always see and erase their data.
do $$
declare
  r record;
  gate_sql text;
begin
  for r in
    select * from (values
      ('core_profiles',               null),
      ('core_settings',               null),
      ('core_consents',               null),
      ('plan_visit_plans',            'cloud_sync'),
      ('plan_items',                  'cloud_sync'),
      ('plan_support_cards',          'cloud_sync'),
      ('plan_support_items',          'cloud_sync'),
      ('plan_support_top_questions',  'cloud_sync'),
      ('practice_sessions',           'cloud_sync'),
      ('practice_turns',              'cloud_sync'),
      ('practice_item_outcomes',      'cloud_sync'),
      ('recap_recaps',                'cloud_sync'),
      ('recap_transcript_lines',      'cloud_sync'),
      ('recap_items',                 'cloud_sync'),
      ('recap_unconfirmed_items',     'cloud_sync'),
      ('recap_plan_status',           'cloud_sync'),
      ('persona_facts',               'persona_memory')
    ) as v(tbl, gate)
  loop
    gate_sql := case when r.gate is null then '' else format(' and (select private.has_consent(%L))', r.gate) end;

    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = owner_id)',
                   r.tbl || '_select_own', r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id%s)',
                   r.tbl || '_insert_own', r.tbl, gate_sql);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id%s)',
                   r.tbl || '_update_own', r.tbl, gate_sql);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)',
                   r.tbl || '_delete_own', r.tbl);

    -- Table privileges: only the four verbs, only for signed-in users. Nothing for anon.
    execute format('revoke all on public.%I from public, anon, authenticated', r.tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tbl);
  end loop;
end $$;

-- 9c. Server-only tables: no access for anon or authenticated, full access for service_role.
revoke all on public.ops_ai_usage_daily, public.ops_ai_events, public.ops_ai_events_default,
              public.research_tester_sessions from public, anon, authenticated;
revoke all on sequence public.ops_ai_events_id_seq from public, anon, authenticated;
grant all on public.ops_ai_usage_daily, public.ops_ai_events, public.ops_ai_events_default,
             public.research_tester_sessions to service_role;
grant usage, select on sequence public.ops_ai_events_id_seq to service_role;

-- 9d. Function privileges.
revoke execute on function public.ops_bump_ai_usage(text, integer, bigint)   from public, anon, authenticated;
revoke execute on function public.ops_ai_usage_total(date, text)             from public, anon, authenticated;
revoke execute on function public.ops_prune_ai_usage(integer)                from public, anon, authenticated;
revoke execute on function public.ops_create_ai_event_partition(date)        from public, anon, authenticated;
grant  execute on function public.ops_bump_ai_usage(text, integer, bigint)   to service_role;
grant  execute on function public.ops_ai_usage_total(date, text)             to service_role;
grant  execute on function public.ops_prune_ai_usage(integer)                to service_role;
grant  execute on function public.ops_create_ai_event_partition(date)        to service_role;

revoke execute on function public.core_delete_my_data() from public, anon;
grant  execute on function public.core_delete_my_data() to authenticated;

-- Future tables created in public are not readable by anon unless someone grants it on purpose.
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- ---------------------------------------------------------------------------------------------
-- 10. Labels (visible in the Supabase dashboard table descriptions)
-- ---------------------------------------------------------------------------------------------
comment on table public.core_profiles   is '[CORE][USER-PRIVATE] One row per user: optional first name and helper name.';
comment on table public.core_settings   is '[CORE][USER-PRIVATE] Theme, text size, reading and sound preferences. Created automatically at sign-up.';
comment on table public.core_consents   is '[CORE][USER-PRIVATE] One row per consent kind (cloud_sync, persona_memory, research_counts). Content tables check this in RLS.';
comment on table public.plan_visit_plans is '[PLAN][USER-CONTENT][needs cloud_sync] The visit plan: main concern and symptoms in the user''s own words. One current plan per user.';
comment on table public.plan_items      is '[PLAN][USER-CONTENT][needs cloud_sync] Cards of a plan: concern, question or accommodation. source=suggested items start disabled.';
comment on table public.plan_support_cards is '[PLAN][USER-CONTENT][needs cloud_sync] "How I like to be supported" card. One per plan.';
comment on table public.plan_support_items is '[PLAN][USER-CONTENT][needs cloud_sync] Lines on the support card: preset (preset_key set) or user-written.';
comment on table public.plan_support_top_questions is '[PLAN][USER-CONTENT][needs cloud_sync] Up to 2 plan items the user picked to bring to the visit.';
comment on table public.practice_sessions is '[PRACTICE][USER-CONTENT][needs cloud_sync] One practice run: focus, private readiness rating 1-5, help count.';
comment on table public.practice_turns  is '[PRACTICE][USER-CONTENT][needs cloud_sync] Conversation turns of a practice run. Practice only, never a real visit.';
comment on table public.practice_item_outcomes is '[PRACTICE][USER-CONTENT][needs cloud_sync] Per plan item: said it or not, highest help level used (0-3). Drives help fading.';
comment on table public.recap_recaps    is '[RECAP][USER-CONTENT][needs cloud_sync] Recap of the made-up sample visit. is_saved_fallback=true when live AI was down.';
comment on table public.recap_transcript_lines is '[RECAP][USER-CONTENT][needs cloud_sync] Labelled transcript lines (speakers A-D).';
comment on table public.recap_items     is '[RECAP][USER-CONTENT][needs cloud_sync] Summary items. Each must cite 1-6 transcript lines or it does not belong here.';
comment on table public.recap_unconfirmed_items is '[RECAP][USER-CONTENT][needs cloud_sync] "I could not confirm this" items: no valid evidence.';
comment on table public.recap_plan_status is '[RECAP][USER-CONTENT][needs cloud_sync] "What I said myself": who asked each plan item.';
comment on table public.persona_facts   is '[PERSONA][USER-CONTENT][needs persona_memory] Preference facts the user chose (kind + key + level). No free text by design.';
comment on table public.ops_ai_usage_daily is '[OPS][SERVICE-ONLY] Daily AI call and cost counters per bucket, 16 shards. Counts only.';
comment on table public.ops_ai_events   is '[OPS][SERVICE-ONLY] AI telemetry per request, partitioned by month. Task, outcome, model, tokens, guard codes. Never text, never a user id.';
comment on table public.ops_ai_events_default is '[OPS][SERVICE-ONLY] Catch-all partition. Should stay empty: create the next month with ops_create_ai_event_partition().';
comment on table public.research_tester_sessions is '[RESEARCH][SERVICE-ONLY] Tester-session counts for the pitch. Participant codes, no names.';
comment on function public.core_delete_my_data() is '[CORE] Delete everything for the signed-in user, then reset settings to defaults.';
