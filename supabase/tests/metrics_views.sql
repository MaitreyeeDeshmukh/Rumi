-- Metric views and ops_alert_snapshot: service_role only, numbers add up, no text/user id in the output.
--   bash scripts/db/run-sql.sh supabase/tests/metrics_views.sql      (LOCAL stack)
begin;
insert into public.ops_ai_events (task, outcome, latency_ms, input_tokens, output_tokens, cached_tokens, cost_micro_usd, cache_status) values
  ('plan', 'ok', 100, 10, 5, 4, 1000, 'miss'), ('plan', 'ok', 300, 10, 5, 0, 1000, 'hit'),
  ('plan', 'degraded', 50, 0, 0, 0, 0, 'bypass'), ('plan', 'provider_error', 900, 10, 0, 0, 0, 'miss'),
  ('plan', 'timeout', 8000, 10, 0, 0, 0, 'miss'), ('plan', 'rate_limited', 1, 0, 0, 0, 0, null), ('plan', 'crisis', 1, 0, 0, 0, 0, null);
insert into public.ops_app_events (source, area, code) values ('server', 'ai', 'groq_5xx'), ('server', 'ai', 'groq_5xx'), ('client', 'sync', 'offline');
insert into public.ops_ai_usage_daily (day, bucket, shard, calls, cost_micro_usd) values ((now() at time zone 'utc')::date, 'global', 0, 7, 2500000);

alter table public.core_settings disable trigger core_settings_touch;
insert into auth.users (id, is_anonymous, created_at) values ('a0000000-0000-0000-0000-0000000000f1', true, now() - interval '100 days');
update public.core_settings set updated_at = now() - interval '100 days' where owner_id = 'a0000000-0000-0000-0000-0000000000f1';
alter table public.core_settings enable trigger core_settings_touch;

-- the views themselves carry no grant for users (security_invoker would block them anyway: two locks, not one)
do $$ declare v text; begin
  foreach v in array array['ops_v_ai_daily', 'ops_v_app_errors_daily', 'ops_v_usage_today', 'ops_v_ai_recent_30m'] loop
    if has_table_privilege('authenticated', 'public.' || v, 'select') or has_table_privilege('anon', 'public.' || v, 'select') then
      raise exception 'FAIL: view % is granted to a user role', v; end if;
    if not has_table_privilege('service_role', 'public.' || v, 'select') then raise exception 'FAIL: service_role cannot read %', v; end if;
  end loop;
end $$;

set local role authenticated;
do $$ declare v text; begin
  foreach v in array array['ops_v_ai_daily', 'ops_v_app_errors_daily', 'ops_v_usage_today', 'ops_v_ai_recent_30m'] loop
    begin execute format('select 1 from public.%I', v); raise exception 'FAIL: user can read %', v;
    exception when insufficient_privilege then null; end;
  end loop;
  begin perform public.ops_alert_snapshot(); raise exception 'FAIL: user called ops_alert_snapshot';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.ops_v_ai_daily; raise exception 'FAIL: anon can read ops_v_ai_daily';
  exception when insufficient_privilege then null; end;
  begin perform public.ops_alert_snapshot(); raise exception 'FAIL: anon called ops_alert_snapshot';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ declare s jsonb; d record; begin
  select * into d from public.ops_v_ai_daily where task = 'plan';
  if d.calls <> 7 or d.provider_calls <> 5 or d.cached_tokens <> 4 then raise exception 'FAIL: daily view numbers % % %', d.calls, d.provider_calls, d.cached_tokens; end if;
  if d.error_rate <> 0.4 or d.degraded_rate <> 0.2 then raise exception 'FAIL: rates % %', d.error_rate, d.degraded_rate; end if;
  s := public.ops_alert_snapshot();
  if (s -> 'ai_30m' ->> 'calls')::int <> 5 or (s -> 'ai_30m' ->> 'error_calls')::int <> 2 or (s -> 'ai_30m' ->> 'degraded_calls')::int <> 1 then
    raise exception 'FAIL: snapshot ai_30m %', s -> 'ai_30m'; end if;
  if (s -> 'usage_today' ->> 'global_calls')::int <> 7 or (s -> 'usage_today' ->> 'global_cost_usd')::numeric <> 2.5 then
    raise exception 'FAIL: snapshot usage %', s -> 'usage_today'; end if;
  if (s -> 'app_events_30m' ->> 'ai')::int <> 2 or (s -> 'app_events_30m' ->> 'sync')::int <> 1 then
    raise exception 'FAIL: snapshot app events %', s -> 'app_events_30m'; end if;
  if (s ->> 'default_partition_rows')::boolean then raise exception 'FAIL: default partition reported non-empty'; end if;
  -- final shape: every key present
  if not (s ?& array['at', 'ai_30m', 'usage_today', 'app_events_30m', 'default_partition_rows', 'last_maintenance', 'anon_purge_enabled', 'anonymous_user_backlog']) then
    raise exception 'FAIL: snapshot keys: %', (select string_agg(k, ',') from jsonb_object_keys(s) k); end if;
  if (select count(*) from jsonb_object_keys(s)) <> 8 then raise exception 'FAIL: snapshot has unexpected keys'; end if;
  -- one entry per maintenance job; null status/at until the job has run
  if (select array_agg(k order by k) from jsonb_object_keys(s -> 'last_maintenance') k) <> array['anon-purge', 'health', 'partitions', 'prune', 'retention'] then
    raise exception 'FAIL: last_maintenance jobs: %', s -> 'last_maintenance'; end if;
  if not (s -> 'last_maintenance' -> 'prune' ? 'status' and s -> 'last_maintenance' -> 'prune' ? 'at') then raise exception 'FAIL: last_maintenance entry shape'; end if;
  if (s ->> 'anon_purge_enabled')::boolean then raise exception 'FAIL: purge must be off by default'; end if;
  if (s ->> 'anonymous_user_backlog')::int <> 1 then raise exception 'FAIL: backlog should be 1, is %', s ->> 'anonymous_user_backlog'; end if;
  if (select count(*) from public.ops_v_usage_today where scope = 'global') <> 1 then raise exception 'FAIL: usage view'; end if;
  if (select events from public.ops_v_app_errors_daily where code = 'groq_5xx') <> 2 then raise exception 'FAIL: app errors view'; end if;
end $$;
reset role;
select 'ALL METRICS VIEW TESTS PASSED' as result;
rollback;
