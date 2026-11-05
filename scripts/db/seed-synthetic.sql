-- SYNTHETIC load data for the 100k-user check. No real names, text or ids: every value is generated.
-- LOCAL stack only. This file does not start or end a transaction: scripts/db/scale-check.sh wraps it
-- (and the checks) in begin ... rollback, so the local database is left untouched.
-- Size: set rumi.seed_users first (default 100000), e.g.  set local rumi.seed_users = '20000';
--
-- Per user: profile + settings (sign-up trigger), 2 consents, 1 plan with 3 items, 1 support card with
-- 2 lines and 2 top questions, 1 practice session with 4 turns and 3 outcomes, 5 persona facts.
-- Every second user also has a recap with 6 transcript lines, 3 items, 1 unconfirmed item, 3 plan statuses.
-- 90% of users are anonymous, spread over 120 days of age (about 45% are older than the 60-day purge limit).
-- Ids are md5-based uuids: user i = md5('u'||i), plan i = md5('p'||i), card i = md5('c'||i), session i = md5('s'||i), recap i = md5('r'||i).
do $$
declare n integer := coalesce(nullif(current_setting('rumi.seed_users', true), ''), '100000')::integer;
  t0 timestamptz := clock_timestamp();
begin
  insert into auth.users (id, is_anonymous, created_at, last_sign_in_at)
  select md5('u' || g)::uuid,
         g % 10 <> 0,
         now() - (g % 120) * interval '1 day',
         least(now(), now() - (g % 120) * interval '1 day' + (g % 90) * interval '1 day')
  from generate_series(1, n) g;
  raise notice 'seeded % after % s', 'auth.users', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.core_consents (owner_id, kind, granted, policy_version, granted_at)
  select md5('u' || g)::uuid, k, true, 'v1', now() from generate_series(1, n) g, unnest(array['cloud_sync', 'persona_memory']) k;
  raise notice 'seeded % after % s', 'public.core_consents', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.plan_visit_plans (id, owner_id, title, main_concern, symptoms_in_my_words, created_at, updated_at)
  select md5('p' || g)::uuid, md5('u' || g)::uuid, 'synthetic plan ' || g, 'synthetic concern', array['synthetic symptom'], now() - (g % 120) * interval '1 day', now() - (g % 120) * interval '1 day'
  from generate_series(1, n) g;
  raise notice 'seeded % after % s', 'public.plan_visit_plans', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.plan_items (owner_id, plan_id, position, local_id, text, kind, source)
  select md5('u' || g)::uuid, md5('p' || g)::uuid, pos, 'q' || pos, 'synthetic question ' || pos, 'question', 'user'
  from generate_series(1, n) g, generate_series(0, 2) pos;
  raise notice 'seeded % after % s', 'public.plan_items', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.plan_support_cards (id, owner_id, plan_id)
  select md5('c' || g)::uuid, md5('u' || g)::uuid, md5('p' || g)::uuid from generate_series(1, n) g;
  raise notice 'seeded % after % s', 'public.plan_support_cards', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.plan_support_items (owner_id, card_id, position, text, source)
  select md5('u' || g)::uuid, md5('c' || g)::uuid, pos, 'synthetic support line ' || pos, 'user'
  from generate_series(1, n) g, generate_series(0, 1) pos;
  raise notice 'seeded % after % s', 'public.plan_support_items', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.plan_support_top_questions (card_id, position, owner_id, plan_item_id)
  select c.id, pi.position + 1, c.owner_id, pi.id
  from public.plan_support_cards c join public.plan_items pi on pi.plan_id = c.plan_id and pi.position in (0, 1);
  raise notice 'seeded % after % s', 'public.plan_support_top_questions', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.practice_sessions (id, owner_id, plan_id, focus, status, help_count, created_at, updated_at)
  select md5('s' || g)::uuid, md5('u' || g)::uuid, md5('p' || g)::uuid, 'whole', 'completed', g % 4, now() - (g % 120) * interval '1 day', now() - (g % 120) * interval '1 day'
  from generate_series(1, n) g;
  raise notice 'seeded % after % s', 'public.practice_sessions', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.practice_turns (owner_id, session_id, turn_index, role, text, used_help)
  select md5('u' || g)::uuid, md5('s' || g)::uuid, t, case when t % 2 = 0 then 'clinician' else 'me' end, 'synthetic turn ' || t, false
  from generate_series(1, n) g, generate_series(0, 3) t;
  raise notice 'seeded % after % s', 'public.practice_turns', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.practice_item_outcomes (session_id, plan_item_id, owner_id, covered, help_level_used)
  select s.id, pi.id, s.owner_id, true, 0
  from public.practice_sessions s join public.plan_items pi on pi.plan_id = s.plan_id;
  raise notice 'seeded % after % s', 'public.practice_item_outcomes', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.recap_recaps (id, owner_id, plan_id, my_speaker, created_at)
  select md5('r' || g)::uuid, md5('u' || g)::uuid, md5('p' || g)::uuid, 'B', now() - (g % 120) * interval '1 day' from generate_series(1, n) g where g % 2 = 0;
  raise notice 'seeded % after % s', 'public.recap_recaps', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.recap_transcript_lines (owner_id, recap_id, line_no, local_id, speaker, text)
  select md5('u' || g)::uuid, md5('r' || g)::uuid, l, 'l' || l, 'A', 'synthetic line ' || l
  from generate_series(2, n, 2) g, generate_series(1, 6) l;
  raise notice 'seeded % after % s', 'public.recap_transcript_lines', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.recap_items (owner_id, recap_id, position, section, text, evidence_line_nos)
  select md5('u' || g)::uuid, md5('r' || g)::uuid, p, 'discussed', 'synthetic item ' || p, array[1]::smallint[]
  from generate_series(2, n, 2) g, generate_series(0, 2) p;
  raise notice 'seeded % after % s', 'public.recap_items', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.recap_unconfirmed_items (owner_id, recap_id, position, text)
  select md5('u' || g)::uuid, md5('r' || g)::uuid, 0, 'synthetic unconfirmed' from generate_series(2, n, 2) g;
  raise notice 'seeded % after % s', 'public.recap_unconfirmed_items', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.recap_plan_status (recap_id, plan_item_id, owner_id, status)
  select r.id, pi.id, r.owner_id, 'unclear'
  from public.recap_recaps r join public.plan_items pi on pi.plan_id = r.plan_id;
  raise notice 'seeded % after % s', 'public.recap_plan_status', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  insert into public.persona_facts (owner_id, kind, key, level, created_at, updated_at)
  select md5('u' || g)::uuid, 'support_pref', 'p' || k, null, now() - (g % 120) * interval '1 day', now() - (g % 120) * interval '1 day' from generate_series(1, n) g, generate_series(1, 5) k;

  -- the sign-up trigger stamped every settings row with now(): give them the user's age (the touch trigger would undo it)
  alter table public.core_settings disable trigger core_settings_touch;
  update public.core_settings s set updated_at = u.created_at from auth.users u where u.id = s.owner_id;
  alter table public.core_settings enable trigger core_settings_touch;
  raise notice 'seeded % after % s', 'public.persona_facts', round(extract(epoch from clock_timestamp() - t0)::numeric, 1);
end $$;
