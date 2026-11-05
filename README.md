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
