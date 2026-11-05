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

## Aakash's feature lane (November 5)

`lane/features` is based on `rumi-restructure`. It implements the shared TypeScript
contract for Plan, Practice, Say It, and Recap. It adds no dependencies, API keys,
accounts, database tables, or model-provider calls. The team's shared contract
selects Gemini through Rudheer's harness; the older architecture paragraph above
is historical, not the configuration of this feature lane.

### What is implemented

- `apps/web/src/features/plan`: editable plans preserving exact user excerpts;
  optional suggestions remain off until chosen. Exact excerpt checks are conservative
  and can reject valid paraphrases. They do not prove a clinical fact.
- `apps/web/src/features/practice`: focused prompt, bounded turns, deterministic mock,
  help-level helpers, and summaries that count distinct enabled items. Help is optional;
  the counts are reviewable observations, not a measure of independence or ability.
- `apps/web/src/features/sayit`: hints, fill-in sentences, and complete wording;
  unknown details remain blanks. The `newFacts` heuristic is limited to certain
  numbers and names: it is not a guarantee against invented facts.
- `apps/web/src/features/recap`: synthetic sample only, source-sentence checks,
  speaker attribution, and saved examples adjusted to the selected speaker.
- `apps/web/src/lib/literalLint.ts`: sentence length, idiom, and command checks.
  This is a writing heuristic, not a validated measure of cognitive accessibility.
- `apps/web/prompts`: versioned prompts and an HTML export entry point.
- `apps/web/tests/evals/data`: 10 plan, 10 practice, 15 Say It, 4 recap, 20 adversarial
  cases, and a crisis dataset with 15 positive, 14 ordinary negative, and one separately
  labeled known false-positive input. No live evaluation results are claimed.

### Integration with the other lanes

The harness was not present on the fetched remote branches when this work was built.
No unauthenticated substitute AI endpoint or mock-only public endpoint is exposed.
The four `features/<task>/route.ts` files export `createPost(runTask)` adapters.
Once Rudheer's harness is merged, add the following Next.js route for each task:

```ts
// apps/web/src/app/api/plan/route.ts
import { runTask } from '@/lib/ai/harness';
import { createPost } from '@/features/plan/route';
export const maxDuration = 30;
export const POST = createPost(runTask);
```

Repeat for `practice`, `sayit`, and `recap`. The harness owns request limits,
normalization, crisis routing, PII redaction, injection checks, retries, model calls,
response validation, and `Cache-Control: no-store`. Feature `build()` functions
consume the harness's safe text map and use positional prompt labels, never raw IDs.
The feature preamble and escaping helpers live in `prompts/shared.ts`; they do not
replace the harness's security controls. The harness must guard all browser input
before using mocks as well as before live calls.

Maitreyee can replace temporary exports in `components/deps/index.ts` with:

```ts
export { FOCUS_LABEL, itemsForFocus, summarizeSession, startLevelFor } from '@/features/practice';
export { DEMO_PLAN, SAMPLE_VISIT, SAVED_RECAP_REPLY, savedRecapForSpeaker } from '@/fixtures';
```

Use `savedRecapForSpeaker(selectedSpeaker)` for a saved fallback. A recap fixed to
speaker B would misattribute participation when the user selected A or C. Replace
all sample fixtures together so transcript and plan IDs remain aligned. The local
route mocks are deterministic examples, not AI output or proof of model accuracy.

### Deliberate corrections to the starter assignment

- Plan facts use exact excerpts rather than one shared word as evidence. User wording
  is preserved even when it does not meet the app-generated wording rules.
- The `next_steps` practice uses an explicitly pretend nonmedical task, not invented
  clinical instructions.
- Recap statements must match complete source sentences. This preserves negation;
  `Do not take ...` must never become `Take ...`. Speaker A is the clinician only in
  the supplied synthetic sample. Real transcription and speaker identification are
  outside this release.
- The sample credits Sam for describing the concern in line 4, even though Mom also
  describes it in line 2. Supporting someone does not erase their participation.
- Practice mocks do not mark items covered merely because time or turns passed.
- A failed evidence check reports the item number rather than repeating an invented
  medical instruction in the unconfirmed section.
- Prompt export lives in the feature-owned `prompts/` directory, leaving Rudheer's
  `scripts/` files untouched. His submission exporter can reuse these constants.

### Validation and prompt export

From `apps/web`, run the team's usual `pnpm check`. If the pinned pnpm executable
cannot launch locally, the equivalent individual checks are `npm run lint`,
`npm run typecheck`, and `npm run test`. Do not change the team's lockfile just to
work around a local package-manager issue.

```bash
node --experimental-strip-types prompts/export.mjs /tmp/rumi-prompts.html
```

The export includes actual feature prompt text, versions, literal-mode rules, and
shared schema source. It includes `tests/evals/last-run.json` only if that file exists;
otherwise it explicitly reports that live evaluation has not run. Review the exported
examples for sensitive data before printing or submitting. This feature-only export
still needs Rudheer's full harness preamble and security rules for the final pack.

Remaining gates: merge the harness and UI adapters, run each focus by hand, run the
real-model evals, and ask intended users whether the language, pace, and controls
work for them. No claim of clinical effectiveness or universal usability is made.
