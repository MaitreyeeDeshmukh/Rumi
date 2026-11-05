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
1. Open `https://<app>/api/ready`. `200 {"ok":true}` means configuration and the database answer. `503 {"failed":["database"]}` names what is down (`env` or `database`).
2. Open the GitHub issues labelled `alert`. The alert job opens one per problem and closes it when the problem is gone.
3. In Supabase, run `select * from ops_v_app_errors_daily order by day desc, events desc limit 20;`. A jump in one `release` points to a bad deploy.
4. To follow one failed request: every response carries an `x-request-id` header and an error body `requestId`. Search that id in the Vercel logs.

### Health checks
| URL | Meaning | Use for |
| --- | --- | --- |
| `/api/health` | The server process answers. Checks nothing else. | Uptime monitor, 1 minute. Never fails because of the database. |
| `/api/ready` | Configuration is complete and one database call works (2 s cap, cached 5 s). | Deploy check, alert job, a second uptime monitor. |

### Dashboards
Views in `supabase/views/metrics.sql`. Counts, rates, latency and cost only. No text, no user id. Read them with the Supabase SQL editor (service role).
| View | Shows |
| --- | --- |
| `ops_v_ai_daily` | Per task per day: calls, error rate, fallback rate, p50 and p95 ms, tokens, cached tokens, cost USD |
| `ops_v_app_errors_daily` | App events per day by source, area, code, release, with distinct fingerprints |
| `ops_v_usage_today` | Today's calls and cost by scope: `global`, `user`, `ip` |
| `ops_v_ai_recent_30m` | Last 30 minutes: provider calls, errors, fallbacks (the alert job reads this) |

### Alerts
The workflow `.github/workflows/alerts.yml` runs every 15 minutes. Rules are in `apps/web/src/lib/telemetry/alerts.ts`.
| Alert issue | Fires when | Go to runbook |
| --- | --- | --- |
| `[alert] provider_errors` | More than 10% of provider calls failed in 30 minutes (at least 20 calls) | Provider down |
| `[alert] degraded_replies` | More than 25% of calls used the fallback in 30 minutes (at least 20 calls) | Provider down |
| `[alert] spend_cap` | Spend today is over 80% of `AI_DAILY_GLOBAL_SPEND_CAP_USD` (default 10) | Cost spike |
| `[alert] not_ready` | `/api/ready` returned 503 or did not answer | Database down, or Bad deploy |
| `[alert] metrics_unreachable` | The alert job could not read the metric views | Check the alert secrets and the Supabase project |

If the workflow itself fails, GitHub emails the repository admins. Treat that as `metrics_unreachable`.

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

If the database cannot be read, AI stays on and cloud writes stay off.

### Runbooks
**Provider down** (Groq errors, timeouts, many fallbacks). People still get answers: the app serves the fallback and says so.
1. Check the provider status page. Check `ops_v_ai_recent_30m`.
2. If it lasts more than 15 minutes, set `ai_enabled = false` to stop the retries. Set it back to true when the provider recovers.
3. Do not rotate keys unless a key leaked.

**Auth down** (sign-in fails, "Saving is paused" in the app). The app keeps working on the device.
1. Check the Supabase status page and Authentication settings: anonymous sign-ins must be on, and the Vercel domain must be in the redirect URLs.
2. Look at `ops_v_app_errors_daily` where `area = 'auth'`.
3. Nothing to flip. Data is safe on the device. Sign-in retries by itself.

**Database down** (`/api/ready` says `database`). Cloud saving stops by itself; the app keeps working on the device.
1. Check the Supabase dashboard and status page.
2. If the project is paused, restore it. If it is overloaded, look for a slow query in Database, Query performance.
3. When `/api/ready` is 200 again, close the issue.

**Cost spike** (`spend_cap`).
1. `select * from ops_v_usage_today;` and `select * from ops_v_ai_daily where day = current_date;`. Look at `max_calls_per_bucket` (one heavy user or address) and at which task grew.
2. To stop spend now: `ai_enabled = false`.
3. Lower `AI_DAILY_USER_LIMIT` in Vercel and redeploy. Check the spend limit set in the provider console.

**Leaked key.** Rotate first, investigate after.
1. Create a new key in the provider or Supabase console (Supabase: Settings, API keys). Delete the old one.
2. Update the value in Vercel (mark it Sensitive) and in the GitHub secret if the alert job uses it. Redeploy.
3. Search the logs for the old key's first characters. The logger redacts keys, so a hit means a bug: open an issue.

**Bad deploy.** Signs: `not_ready`, or one `release` with a jump in `ops_v_app_errors_daily`.
1. Vercel, Deployments, pick the last good one, Promote (Instant Rollback).
2. Check `/api/ready` and `/api/health`.
3. Database changes are forward only. Never undo a migration by hand. Ship a new migration that fixes it.

### Logs and errors
- One JSON line per event with `ts, level, event, requestId, route, release`. Fields named like text, body, prompt, email, token, key, secret, password or user id are dropped. Long strings become `h:<hash>`.
- Caller mistakes (bad input, signed out, rate limited) are `warn`. Only server faults are `error`, once per fault, with a `fingerprint`. The error message is never logged or sent.
- The browser reports a crash to `/api/client-error` with a fixed code, the page path and Next.js's error digest only.
- Telemetry never slows or fails a request. If the database is down, events still reach the logs, and database writes pause for 30 seconds after 5 failures in a row.

### Sentry (optional, off)
Not installed. The adapter and the `beforeSend` scrubber are in `apps/web/src/lib/telemetry/sentry.ts`. To turn on: `pnpm add @sentry/nextjs`, set `SENTRY_DSN`, and register the reporter as described at the top of that file. It sends the error code, fingerprint, route and release only: no message, request, user or breadcrumbs.

### One-time setup the code cannot do
- Uptime monitor on `/api/health` and `/api/ready`, alerting a person.
- GitHub repository secrets `ALERTS_SUPABASE_URL`, `ALERTS_SUPABASE_KEY`, `ALERTS_APP_URL`; optional variable `AI_DAILY_GLOBAL_SPEND_CAP_USD`. `ALERTS_SUPABASE_KEY` is a service-role key: keep it only as a GitHub secret.
- Apply `supabase/views/metrics.sql` in a migration, after the production v2 migration.

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
