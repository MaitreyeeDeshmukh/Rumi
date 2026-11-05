-- Rumi operations metrics. Read-only views over ops_ai_events, ops_app_events and ops_ai_usage_daily.
-- Source: supabase/views/metrics.sql from branch agent/prod-observability, shipped as a migration so it runs after v2 (needs ops_app_events and ops_ai_events.cached_tokens).
--
-- Rules:
--   * Counts, rates, latencies and cost only. The source tables hold no text and no user id.
--   * security_invoker = true and no grant to anon/authenticated: only service_role (dashboards, the alert job) can read.
--   * Every view filters created_at with now() - interval, so Postgres prunes the monthly partitions it does not need.
--   * "Provider calls" are the outcomes that reached the provider: ok, degraded, provider_error, timeout, guard_blocked.
--     Crisis, rate_limited, invalid_input, unauthorized and config_error never reached it, so they are not in the error rate.
--   * "Error" = provider_error, timeout. "Degraded" = the deterministic fallback was served.

create or replace view public.ops_v_ai_daily with (security_invoker = true) as
select
  (created_at at time zone 'utc')::date                                              as day,
  task,
  count(*)::bigint                                                                   as calls,
  count(*) filter (where outcome in ('ok', 'degraded', 'provider_error', 'timeout', 'guard_blocked'))::bigint as provider_calls,
  round(
    (count(*) filter (where outcome in ('provider_error', 'timeout')))::numeric
    / nullif(count(*) filter (where outcome in ('ok', 'degraded', 'provider_error', 'timeout', 'guard_blocked')), 0), 4) as error_rate,
  round(
    (count(*) filter (where outcome = 'degraded'))::numeric
    / nullif(count(*) filter (where outcome in ('ok', 'degraded', 'provider_error', 'timeout', 'guard_blocked')), 0), 4) as degraded_rate,
  round(percentile_cont(0.5)  within group (order by latency_ms))::integer           as p50_ms,
  round(percentile_cont(0.95) within group (order by latency_ms))::integer           as p95_ms,
  coalesce(sum(input_tokens), 0)::bigint                                             as input_tokens,
  coalesce(sum(output_tokens), 0)::bigint                                            as output_tokens,
  coalesce(sum(cached_tokens), 0)::bigint                                            as cached_tokens,
  round(coalesce(sum(cost_micro_usd), 0)::numeric / 1000000, 4)                      as cost_usd
from public.ops_ai_events
where created_at >= now() - interval '30 days'
group by 1, 2;

create or replace view public.ops_v_app_errors_daily with (security_invoker = true) as
select
  (created_at at time zone 'utc')::date as day,
  source,
  area,
  code,
  release,
  count(*)::bigint                      as events,
  count(distinct fingerprint)::bigint   as fingerprints,
  max(created_at)                       as last_seen
from public.ops_app_events
where created_at >= now() - interval '30 days'
group by 1, 2, 3, 4, 5;

-- One row per scope for today (UTC): global, user ('u:...'), ip ('ip:...'), other.
create or replace view public.ops_v_usage_today with (security_invoker = true) as
with per_bucket as (
  select bucket, sum(calls)::bigint as calls, sum(cost_micro_usd)::bigint as cost_micro_usd
  from public.ops_ai_usage_daily
  where day = (now() at time zone 'utc')::date
  group by bucket
)
select
  case when bucket = 'global' then 'global' when bucket like 'u:%' then 'user' when bucket like 'ip:%' then 'ip' else 'other' end as scope,
  count(*)::bigint                                          as buckets,
  coalesce(sum(calls), 0)::bigint                           as calls,
  coalesce(max(calls), 0)::bigint                           as max_calls_per_bucket,
  round(coalesce(sum(cost_micro_usd), 0)::numeric / 1000000, 4) as cost_usd
from per_bucket
group by 1;

-- The last 30 minutes in one row. The alert job reads this.
create or replace view public.ops_v_ai_recent_30m with (security_invoker = true) as
select
  (count(*) filter (where outcome in ('ok', 'degraded', 'provider_error', 'timeout', 'guard_blocked')))::bigint as calls,
  (count(*) filter (where outcome in ('provider_error', 'timeout')))::bigint                                      as error_calls,
  (count(*) filter (where outcome = 'degraded'))::bigint                                                          as degraded_calls
from public.ops_ai_events
where created_at >= now() - interval '30 minutes';

revoke all on public.ops_v_ai_daily, public.ops_v_app_errors_daily, public.ops_v_usage_today, public.ops_v_ai_recent_30m from public, anon, authenticated;
grant select on public.ops_v_ai_daily, public.ops_v_app_errors_daily, public.ops_v_usage_today, public.ops_v_ai_recent_30m to service_role;

comment on view public.ops_v_ai_daily is '[OPS][SERVICE-ONLY] AI calls, error and degraded rate, p50/p95 latency, tokens and cost per task per day, last 30 days.';
comment on view public.ops_v_app_errors_daily is '[OPS][SERVICE-ONLY] App events per day by source, area, code and release, last 30 days.';
comment on view public.ops_v_usage_today is '[OPS][SERVICE-ONLY] Today''s usage by scope (global, user, ip). Alert job reads scope = global.';
comment on view public.ops_v_ai_recent_30m is '[OPS][SERVICE-ONLY] Provider calls, errors and fallbacks in the last 30 minutes. Alert job reads it.';

-- One call for the alert job (service_role only), so it does not read tables directly.
-- Shape: { at, ai_30m: {calls, error_calls, degraded_calls}, usage_today: {global_calls, global_cost_usd},
--          app_events_30m: {<area>: count}, default_partition_rows: bool }
create or replace function public.ops_alert_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'at', now(),
    'ai_30m', (select to_jsonb(r) from public.ops_v_ai_recent_30m r),
    'usage_today', (select jsonb_build_object('global_calls', coalesce(sum(calls), 0), 'global_cost_usd', round(coalesce(sum(cost_micro_usd), 0)::numeric / 1000000, 4))
                    from public.ops_ai_usage_daily where day = (now() at time zone 'utc')::date and bucket = 'global'),
    'app_events_30m', (select coalesce(jsonb_object_agg(area, n), '{}'::jsonb)
                       from (select area, count(*) as n from public.ops_app_events where created_at >= now() - interval '30 minutes' group by area) a),
    'default_partition_rows', exists (select 1 from public.ops_app_events_default) or exists (select 1 from public.ops_ai_events_default));
$$;
revoke execute on function public.ops_alert_snapshot() from public, anon, authenticated;
grant  execute on function public.ops_alert_snapshot() to service_role;
comment on function public.ops_alert_snapshot() is '[OPS][SERVICE-ONLY] One-row JSON for the alert job: AI errors and fallbacks (30 min), global usage today, app events by area (30 min), default-partition rows.';
