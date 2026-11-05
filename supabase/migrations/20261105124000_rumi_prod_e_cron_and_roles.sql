-- Rumi production migration E of E: SCHEDULES, ROLE SETTINGS, DEFAULT PRIVILEGES. One transaction.
-- Nothing here locks an application table.
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------
-- pg_cron: one job per maintenance step, each its own transaction, staggered. Each command sets its own statement_timeout
-- first (a role-level timeout would otherwise cancel a long step). Jobs run as the user who schedules them
-- (postgres here); the step functions are SECURITY DEFINER owned by postgres. Check after applying:
--   select jobname, username from cron.job;                                   (username = postgres for every rumi-maint-* job)
--   select proname, proowner::regrole, prosecdef from pg_proc where proname like 'ops_maint%';
-- ---------------------------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

do $$
declare j record;
begin
  -- the single job of an earlier draft, if it was ever scheduled
  for j in select jobid from cron.job where jobname = 'rumi-ops-maintenance-daily' loop
    perform cron.unschedule(j.jobid);
  end loop;
  -- cron.schedule with an existing name replaces that job, so applying again is safe
  perform cron.schedule('rumi-maint-partitions', '17 3 * * *', 'set statement_timeout = ''10min''; select public.ops_maint_partitions()');
  perform cron.schedule('rumi-maint-retention',  '19 3 * * *', 'set statement_timeout = ''10min''; select public.ops_maint_retention()');
  perform cron.schedule('rumi-maint-prune',      '21 3 * * *', 'set statement_timeout = ''10min''; select public.ops_maint_prune()');
  perform cron.schedule('rumi-maint-anon-purge', '23 3 * * *', 'set statement_timeout = ''10min''; select public.ops_maint_anon_purge()');
  perform cron.schedule('rumi-maint-health',     '25 3 * * *', 'set statement_timeout = ''10min''; select public.ops_maint_health()');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Role timeouts. PostgREST applies the settings of the request role to every request.
-- (The maintenance cron commands set their own statement_timeout, so these never cancel maintenance.)
-- ---------------------------------------------------------------------------------------------
alter role anon set statement_timeout = '3s';
alter role anon set idle_in_transaction_session_timeout = '30s';
alter role anon set lock_timeout = '5s';
alter role authenticated set statement_timeout = '8s';
alter role authenticated set idle_in_transaction_session_timeout = '30s';
alter role authenticated set lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------
-- Default privileges: a function or table created later by postgres in schema public is NOT reachable by anon, and
-- functions are not executable by PUBLIC or authenticated unless a migration grants them on purpose.
-- (Objects owned by supabase_admin, e.g. extension functions, are outside what postgres may change.)
-- ---------------------------------------------------------------------------------------------
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
