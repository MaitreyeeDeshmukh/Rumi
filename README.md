# Rumi
North American AI Challenge

Your world. Your pace. Your way. An independence and community companion for neurodivergent young adults: healthcare visit preparation, practice conversations, calm help when plans change, and finding your people.

Rumi is a **mobile-first web app**: it is designed to run in a phone browser, with no native app to install. It also works on tablet and desktop.

## Try it
Open `prototype/dist/index.html` in a browser. No install needed (React and fonts load from a CDN, so it needs internet).

## What is real and what is simulated
| Area | Today |
| --- | --- |
| Screens, flows, accessibility, three themes | Real, in `prototype/` |
| AI replies, practice calls, summaries, circles chat, bookings, sharing | **Simulated** on-device with sample data |
| Voice (Cartesia), AI (OpenAI), accounts and database (Supabase) | **Planned** (see "Planned architecture" below) |

All sample data is fictional. Rumi is not medical advice and cannot contact emergency services.

## Repository map
| Path | What it is |
| --- | --- |
| `prototype/` | Frozen interactive demo (React 18 + TypeScript, esbuild to one HTML file) |
| `apps/web/` | Next.js site and app shell (mobile-first): home, safety, help, privacy, accessibility, custom 404 and error pages, security headers, tests. Product features are still being built. |
| `scripts/` | Repo tooling, e.g. `check-no-stray-md.sh` |
| `.githooks/` | Pre-commit checks (secrets, stray Markdown) |
| `.github/` | CI and dependency updates |

## Planned architecture
Next.js + TypeScript, Supabase (Postgres, Auth, Row Level Security), server-side OpenAI with structured outputs, Cartesia for streaming speech (Sonic text-to-speech, Ink speech-to-text), deployed on Vercel. Every AI path runs a crisis check before any model call, then moderation, schema validation and a manual-edit fallback. Testing: Vitest, Playwright, axe accessibility checks and fixed synthetic AI evals. Demos use synthetic data only; real health data requires vendor agreements and a compliance review first.

## Security
No secrets are committed (`.env*` is ignored, `.env.example` holds placeholders), a pre-commit hook and CI run secret scanning (gitleaks), and only this README is tracked as Markdown.

## Operations
Plain steps for whoever is on call. Start at "Check first".

### Check first
1. Open `https://<app>/api/ready`. `200 {"ok":true,"release":"..."}` means configuration and the database answer. `503 {"ok":false}` means something is down. The public answer never says what. To see which dependency failed (`env` or `database`), call it with the header `x-ready-token: <READY_TOKEN>`; the answer then adds `"failed":[...]`. The Vercel logs also name the missing variables or the database failure (`ready_env_missing`, `ready_database_failed`).
2. Open the GitHub issues labelled `alert`. The alert job opens one per problem and closes it when the problem is gone.
3. In Supabase, run `select * from ops_v_app_errors_daily order by day desc, events desc limit 20;`. A jump in one `release` points to a bad deploy.
4. To follow one failed request: every response carries an `x-request-id` header and an error body `requestId`. Search that id in the Vercel logs.

### Health checks and the uptime monitor (required)
| URL | Meaning | Use for |
| --- | --- | --- |
| `/api/health` | The server process answers. Checks nothing else. | Uptime monitor, 1 minute. Never fails because of the database. |
| `/api/ready` | Configuration is complete and one database call works (2 s cap, cached 5 s). | Deploy check, alert job, a second uptime monitor. |

An uptime monitor that is NOT GitHub or Vercel is required, not optional. It is the only alert that still works when the alert workflow is not running (see "Alerts"), and it must page a person. Point one check at `/api/health` and one at `/api/ready`, 1 minute apart, alert after 2 failures.

### Environment variables (observability)
| Variable | Purpose |
| --- | --- |
| `READY_TOKEN` | Secret. Lets the alert job see which dependency failed. Unset means names are never shown. Mark Sensitive in Vercel. |
| `RELEASE` | Build label shown in logs and events. Vercel sets the commit automatically for Git deploys. **Set `RELEASE` on manual deploys** (CLI or upload), or the label falls back to the deployment id. |
| `TELEMETRY_DB_WRITES` | `off` stops all telemetry writes to the database. Logs continue. See "Telemetry stuck". |
| `SENTRY_DSN` | Optional, see Sentry below. |

### Dashboards
Views in `supabase/migrations/20261105130000_rumi_metric_views.sql`. Counts, rates, latency and cost only. No text, no user id. Read them with the Supabase SQL editor (service role).
| View | Shows |
| --- | --- |
| `ops_v_ai_daily` | Per task per day: calls, error rate, fallback rate, p50 and p95 ms, tokens, cached tokens, cost USD |
| `ops_v_app_errors_daily` | App events per day by source, area, code, release, with distinct fingerprints |
| `ops_v_usage_today` | Today's calls and cost by scope: `global`, `user`, `ip` |
| `ops_v_ai_recent_30m` | Last 30 minutes: provider calls, errors, fallbacks |

Known limits of the numbers:
- Cost per task reads 0 until `cost_micro_usd` is filled. The event record has no model or cost field yet. The only real spend figure is the `global` row of `ops_v_usage_today`, which the AI limiter fills.
- `ops_app_events` stores server faults (5xx), browser crash reports, and database-side events. It does NOT store 401, 403, 429 or other caller errors. Those are warning lines in the logs only.
- Server fault rows are at most one per minute per (code, fingerprint, route) per instance, and at most 120 a minute per instance. The log line for each fault is still written; the row that does get written carries a `repeats` count in the log.

### Alerts
The workflow `.github/workflows/alerts.yml` runs every 15 minutes. Rules are in `apps/web/src/lib/telemetry/alerts.ts`; they read the database function `ops_alert_snapshot()` and `/api/ready`.
| Alert issue | Fires when | Go to runbook |
| --- | --- | --- |
| `[alert] provider_errors` | More than 10% of provider calls failed in 30 minutes (at least 20 calls) | Provider down |
| `[alert] degraded_replies` | More than 25% of calls used the fallback in 30 minutes (at least 20 calls) | Provider down |
| `[alert] spend_cap` | Spend today is over 80% of `AI_DAILY_GLOBAL_SPEND_CAP_USD` (default 10) | Cost spike |
| `[alert] app_errors` | More than 10 app error events in 30 minutes | Bad deploy |
| `[alert] not_ready` | `/api/ready` failed twice in a row, 5 seconds apart | Database down, or Bad deploy |
| `[alert] metrics_unreachable` | The job could not read the database, or a job secret is missing | Check the alert secrets and the Supabase project |

An issue is closed as "Cleared" only when its rule was judged and is fine. If the last 30 minutes had too few calls to judge (`provider_errors`, `degraded_replies`) or the metrics were unreadable, the issue stays open and gets one comment "No data". Close it by hand once you have looked.

Things to know:
- **The workflow file must be on the default branch.** GitHub runs schedules only from there. A merge to another branch does nothing.
- GitHub turns scheduled workflows off after 60 days without repository activity, and a failed run is only visible in the Actions tab. Do not rely on GitHub email. This is why the uptime monitor is required.
- **Not covered (accepted gap): silence.** There is no alert for "zero AI calls for hours", for example when the AI path is broken before it records anything. Look at `ops_v_ai_daily` during the day, and watch for a flat line.
- Not covered: fingerprint quality. A fingerprint is the error code plus the file name and line of the first stack frame. It changes when a build changes the bundled file names or line numbers, so one fault can split into two groups after a deploy.
- Not covered: browser crash rows are stamped with the release the server runs when the report arrives, not the release of the page that crashed. An old cached page can be reported under a new release.

### Feature flags
Table `ops_feature_flags` (service role only). Change one in the Supabase SQL editor:
```sql
update public.ops_feature_flags set enabled = false, updated_at = now() where key = 'ai_enabled';
```
Set `enabled = true` to turn it back on. The app caches flags for 30 seconds, so a flip takes effect within about a minute.
| Flag | Off means |
| --- | --- |
| `ai_enabled` | No AI calls. Every reply is the built-in fallback, marked `degraded`. |
| `memory_sync_enabled` | Saved preferences stop syncing. They stay on the device. |
| `cloud_sync_enabled` | Plans and settings stop saving to the cloud. They stay on the device. |

If the database cannot be read, AI stays on and cloud writes stay off. **This is true only after the ai-runtime lane (`lib/ai/flags.ts`) is merged.** Until then nothing reads these flags and flipping one changes nothing.

### Runbooks
**Provider down** (Groq errors, timeouts, many fallbacks). People still get answers: the app serves the fallback and says so.
1. Check the provider status page. Check `ops_v_ai_recent_30m`.
2. If it lasts more than 15 minutes, set `ai_enabled = false` to stop the retries. Set it back to true when the provider recovers.
3. Do not rotate keys unless a key leaked.

**Auth down** (sign-in fails, "Saving is paused" in the app). The app keeps working on the device.
1. Check the Supabase status page and the Authentication dashboard: anonymous sign-ins must be on, and the Vercel domain must be in the redirect URLs. Look at the Authentication logs for 429 or captcha failures.
2. In the Vercel logs, search `request_rejected` with `code":"unauthorized"`. These are warning lines, one a minute per route; they are not in the database tables.
3. Nothing to flip. Data is safe on the device. Sign-in retries by itself.

**Database down** (`/api/ready` fails, the token answer says `database`). Cloud saving stops by itself; the app keeps working on the device.
1. Check the Supabase dashboard and status page.
2. If the project is paused, restore it. If it is overloaded, look for a slow query in Database, Query performance.
3. When `/api/ready` is 200 again, close the issue.

**Event tables too big, or the database is read-only** (disk full: writes fail, `telemetry_store_failed` lines, Supabase warns about disk).
1. The daily job `ops_maintenance_daily()` already drops event partitions older than 90 days. Check that it ran: `select * from cron.job_run_details order by start_time desc limit 5;`.
2. To free space now, drop the oldest month: `select tablename from pg_tables where tablename like 'ops_ai_events_2%' or tablename like 'ops_app_events_2%' order by 1;` then `drop table public.ops_ai_events_YYYY_MM;` (and the same for `ops_app_events_`) for the oldest month. Events are only telemetry.
3. If the database is already read-only, raise the disk size first (Supabase, Settings, Compute and Disk), then do step 2.
4. Telemetry writes pause by themselves while this happens. Turn them off with "Telemetry stuck" if it lasts.

**Telemetry stuck** (many `telemetry_store_failed` or `telemetry_dropped` lines, or request latency up after a telemetry change).
1. Set `TELEMETRY_DB_WRITES=off` in Vercel and redeploy. Logs keep every event; only the database copy stops.
2. Fix the cause (see the table-size and database runbooks), set the variable back to `on` or delete it, redeploy.
3. How the pause works: each table (`ops_ai_events`, `ops_app_events`) has its own breaker. After 5 failures in a row that table is skipped for 30 seconds. Then exactly one call is tried; if it works the table resumes, if not it waits another 30 seconds. Skipped writes are counted and reported as one `telemetry_dropped` warning a minute. Rows from a pause are lost; the logs have them.

**Cost spike** (`spend_cap`).
1. `select * from ops_v_usage_today;` and `select * from ops_v_ai_daily where day = current_date;`. Look at `max_calls_per_bucket` (one heavy user or address) and at which task grew.
2. To stop spend now: `ai_enabled = false` (once the ai-runtime lane is merged).
3. Lower `AI_DAILY_USER_LIMIT` in Vercel and redeploy. Check the spend limit set in the provider console.

**Leaked key.** Add the new one first, remove the old one last, so nothing breaks in between.
1. Create a new key in the provider or Supabase console (Supabase: Settings, API keys). Do not delete the old one yet.
2. Put the new value in Vercel (mark it Sensitive) and in the GitHub environment secret if the alert job uses it. Redeploy and check `/api/ready`.
3. Now revoke the old key in the provider or Supabase console.
4. Search the logs for the old key's first characters. The logger only writes allowed fields, so a hit means a bug: open an issue.

**Bad deploy.** Signs: `not_ready`, `app_errors`, or one `release` with a jump in `ops_v_app_errors_daily`.
1. Vercel, Deployments, pick the last good one, Promote (Instant Rollback).
2. Check `/api/ready` and `/api/health`.
3. Database changes are forward only. Never undo a migration by hand. Ship a new migration that fixes it.

**Migrations before deploy.** New code calls new functions and columns. Apply the migration to Supabase first, then deploy. Deploying first shows up as `telemetry_store_failed` lines and failing features, while `/api/ready` can still say 200 (it checks one function only). The reverse is safe: migrations here only add.

### Logs and errors
- Logs are the record of truth. Rows in `ops_app_events` are best effort: they are written after the response, so a crash, a timeout or a pause can lose them, and repeated faults are collapsed to one row a minute. When the log and the table disagree, trust the log.
- One JSON line per event with `ts, level, event, requestId, route, release`. Only allowlisted fields can appear (code, reason, area, source, outcome, task, tier, store, scope, names, type, digest, fingerprint, status, count, repeats, dropped, attempts, ms, seconds, bytes, ok, suppressed); each must have the right shape. Everything else is dropped. To log a new field, add it to the list at the top of `apps/web/src/lib/log.ts`.
- Caller mistakes (bad input, signed out, rate limited) are `warn`, sampled to one line a minute per route and code with a `repeats` count. Only server faults are `error`, with a `fingerprint`. The error message is never logged or sent.
- The browser reports a crash to `/api/client-error` with a fixed code, a known page route (or `unknown`) and Next.js's error digest only.
- Telemetry never slows or fails a request.

### Sentry (optional, off)
Not installed. The adapter and the `beforeSend` scrubber are in `apps/web/src/lib/telemetry/sentry.ts`. To turn on: `pnpm add @sentry/nextjs`, set `SENTRY_DSN`, and register the reporter as described at the top of that file. It sends the error code, fingerprint, route and release only: no message, request, user or breadcrumbs.

### One-time setup the code cannot do
- Uptime monitor (see above). Required.
- Vercel Firewall: add a rate-limit rule for `POST /api/client-error`, for example 20 requests per minute per IP, action Deny or Challenge. The app also limits it, but only per server instance, so the platform rule is the real flood control.
- Vercel env: `READY_TOKEN` (any long random string, Sensitive), optionally `RELEASE` for manual deploys.
- GitHub: create the environment `alerts` (Settings, Environments), restrict its deployment branches to `main`, and put these ENVIRONMENT secrets in it: `ALERTS_SUPABASE_URL`, `ALERTS_SUPABASE_KEY`, `ALERTS_APP_URL`, `ALERTS_READY_TOKEN` (same value as `READY_TOKEN`). Optional environment variable `AI_DAILY_GLOBAL_SPEND_CAP_USD`.
- `ALERTS_SUPABASE_KEY` is a service-role key today, because `ops_alert_snapshot()` is granted to `service_role` only. The workflow only calls that one function, but the key can do more. Swap it for a read-only database role that can execute only `ops_alert_snapshot()` once the database lane creates one. Until then keep it only in the restricted `alerts` environment.
- Apply the migration `20261105130000_rumi_metric_views.sql` (it also creates `ops_alert_snapshot()`) before the first deploy of this code.

## Build the prototype
Requires Node (version in `.nvmrc`).

```bash
cd prototype
npm install
npm run build   # writes prototype/dist/index.html
```

Prototype source map: `core.tsx` state, icons and shared UI; `data.tsx` sample data and simulated logic; `app.tsx` shell, onboarding, Home; `health.tsx` appointments, prep, practice, recording, summaries; `rescue.tsx` Rescue Mode; `circles.tsx` groups and meetups; `day.tsx` My Day and Money Mirror; `you.tsx` profile, accessibility, privacy, data; `template.html` CSS tokens and page shell.

## Contributing
```bash
git config core.hooksPath .githooks   # once per clone
```
Never commit secrets or real health data. Only this README is committed as Markdown.
