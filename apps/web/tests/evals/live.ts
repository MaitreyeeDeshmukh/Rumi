/**
 * The live adapter (I-019, I-061, I-076): answers eval cases through the REAL harness path (`runTask` with `createGroqProvider`)
 * and through the baseline's single raw call. runner.ts loads this file by name (`loadLiveRun`).
 *
 * This is the one file under tests/evals that is allowed to import the system it measures (src/lib/ai, the four specs); the
 * scorers still share no code with it (tests/unit/evalIndependence.test.ts). It reads no environment value except through
 * `getGroqConfig` / `getEvalCanary`, and it never returns, logs or stores a key, a prompt or a reply text: the observation
 * carries the reply body for scoring (as the route would), counts, codes and the configured model names.
 *
 * `fetchFn` (second argument) is for tests: a scripted Groq. Without it the real `fetch` is used.
 * Requests may run concurrently: each gets its own request id (`HarnessDeps.rand`), and the telemetry line is matched to its
 * request by that id through one log sink installed by `makeLiveRun`.
 */
import { z } from 'zod';
import { planSpec } from '../../src/features/plan/spec';
import { practiceSpec } from '../../src/features/practice/spec';
import { recapSpec } from '../../src/features/recap/spec';
import { sayitSpec } from '../../src/features/sayit/spec';
import type { TaskName, TaskSpec } from '../../src/features/shared/task';
import { runTask } from '../../src/lib/ai/harness';
import { buildCrisisCheckPrompt } from '../../src/lib/ai/prompt';
import { createGroqProvider, ProviderError, REASONING_EFFORT, type Provider, type ProviderCall } from '../../src/lib/ai/provider';
import { setLogSink } from '../../src/lib/ai/telemetry';
import { getEvalCanary, getGroqConfig } from '../../src/lib/env';
import { createRateLimiter } from '../../src/lib/security/rateLimit';
import { PLAN_TASK } from '../../prompts/plan';
import { practiceTask } from '../../prompts/practice';
import { recapTask } from '../../prompts/recap';
import { sayitTask } from '../../prompts/sayit';
import type { BaselineCall, ParitySpec } from './baseline';
import type { RunFn } from './runner';
import type { Arm, CallUsage, EvalCase, Observation } from './types';

export interface LiveDeps {
  fetchFn?: typeof fetch;
}

type AnySpec = TaskSpec<never, unknown, unknown>;
const SPECS: Record<TaskName, AnySpec> = {
  plan: planSpec as unknown as AnySpec,
  practice: practiceSpec as unknown as AnySpec,
  sayit: sayitSpec as unknown as AnySpec,
  recap: recapSpec as unknown as AnySpec,
};

// ---------------------------------------------------------------- what the harness really uses (I-061)

/** The first sentence of the task text the prompt really carries ("TASK: <sentence>"). */
const sentenceOf = (taskText: string): string => /^TASK: (.+)$/m.exec(taskText)?.[1] ?? '';
const TASK_TEXT: Record<TaskName, string> = {
  plan: PLAN_TASK,
  practice: practiceTask('whole'),
  sayit: sayitTask(2),
  recap: recapTask('A'),
};

/** Read from the specs, the prompt files and the provider themselves, so `assertHarnessParity` compares the real thing with the pin. */
export const harnessSpecs: Record<TaskName, ParitySpec> = Object.fromEntries(
  (Object.keys(SPECS) as TaskName[]).map((task) => [
    task,
    {
      tier: SPECS[task].tier,
      temperature: SPECS[task].temperature,
      maxOutputTokens: SPECS[task].maxOutputTokens,
      reasoningEffort: REASONING_EFFORT,
      taskSentence: sentenceOf(TASK_TEXT[task]),
      jsonSchema: z.toJSONSchema(SPECS[task].modelOut),
    },
  ]),
) as Record<TaskName, ParitySpec>;

// ---------------------------------------------------------------- shared helpers

const CLASSIFIER_SYSTEM = buildCrisisCheckPrompt('abcdefgh12', 'x').system;
const BASELINE_TIMEOUT_MS = 22_000;

const configuredModels = (): { quality: string; fast: string } | undefined => {
  try {
    const c = getGroqConfig();
    return { quality: c.modelQuality, fast: c.modelFast };
  } catch {
    // No key or no model names: nothing can have been called, and no model name may be reported.
    return undefined;
  }
};

/** A 429 that names a wait of at most this long is waited out (twice at most): see watchRateLimit. */
const RETRY_AFTER_MAX_MS = 6_000;

const retryAfterMs = (res: Response): number | undefined => {
  const secs = Number(res.headers.get('retry-after'));
  return res.headers.get('retry-after') !== null && Number.isFinite(secs) && secs >= 0 && secs * 1000 <= RETRY_AFTER_MAX_MS ? Math.ceil(secs * 1000) : undefined;
};

/**
 * Wraps fetch to learn whether Groq ever answered 429 (the provider itself reports every non-2xx as 'http').
 * Eval pacing: a 429 that carries a short Retry-After (the per-minute token limit of a small plan) is waited out and the same
 * request sent again, up to twice, so that a quota is not measured as a product failure. A long or missing Retry-After is not waited.
 */
function watchRateLimit(inner: typeof fetch | undefined, seen: { rateLimited: boolean }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      const res = await (inner ?? fetch)(input, init);
      if (res.status !== 429) return res;
      seen.rateLimited = true;
      const wait = retryAfterMs(res);
      if (attempt >= 2 || wait === undefined) return res;
      await res.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }) as typeof fetch;
}

/**
 * Response headers for the leak scan. The Set-Cookie attributes (HttpOnly, Path, Max-Age) are dropped: the scan looks for a
 * forbidden word such as "http" in header text, and the cookie flag HttpOnly would trip it on every first request. The cookie
 * name and value are kept and still scanned.
 */
function scanHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = name.toLowerCase() === 'set-cookie' ? value.split(';')[0] : value;
  });
  return out;
}

const rateLimitedObs = (base: Observation): Observation => ({ ...base, status: 429, degraded: false, modelUsed: null, body: { error: { code: 'rate_limited' } } });

// ---------------------------------------------------------------- counts for the end-of-run line

interface Stats {
  requests: number;
  taskCalls: number;
  classifierCalls: number;
  costMicroUsd: number;
  rateLimited: number;
  outcomes: Record<string, number>;
  guards: Record<string, number>;
}
const freshStats = (): Stats => ({ requests: 0, taskCalls: 0, classifierCalls: 0, costMicroUsd: 0, rateLimited: 0, outcomes: {}, guards: {} });
let stats = freshStats();

const bump = (map: Record<string, number>, key: string): void => {
  map[key] = (map[key] ?? 0) + 1;
};
const pairs = (map: Record<string, number>): string =>
  Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k}=${n}`)
    .join(' ') || 'none';

/** Counts only: which outcomes, which guard codes made the harness reject answers, how many calls, what it cost (estimate). */
export function liveReport(): string[] {
  return [
    `live diagnostics (counts only): requests ${stats.requests}, task calls ${stats.taskCalls} (+ ${stats.classifierCalls} crisis-classifier calls), estimated cost ${stats.costMicroUsd} micro-USD, Groq 429 seen on ${stats.rateLimited} requests`,
    `live outcomes: ${pairs(stats.outcomes)}`,
    `live guard codes: ${pairs(stats.guards)}`,
  ];
}

interface TelemetryLine {
  id?: string;
  outcome?: string;
  guardHits?: string[];
  costMicroUsd?: number;
}
const parseLine = (line: string): TelemetryLine | undefined => {
  try {
    const v: unknown = JSON.parse(line);
    return typeof v === 'object' && v !== null && (v as { type?: unknown }).type === 'ai_task' ? (v as TelemetryLine) : undefined;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------- harness arm

interface Recorder {
  calls: CallUsage[];
  taskCalls: number;
  classifierCalls: number;
  lastTier: 'quality' | 'fast' | null;
  lastModel: string | null;
  canaryInPrompt: boolean;
}

/** Records every provider call the harness makes (the classifier question and the task call are told apart by the fixed classifier prompt). */
function recording(inner: Provider, rec: Recorder, canary: string | undefined): Provider {
  return {
    async complete(call: ProviderCall) {
      const classifier = call.system === CLASSIFIER_SYSTEM;
      if (classifier) rec.classifierCalls += 1;
      else {
        rec.taskCalls += 1;
        rec.lastTier = call.tier;
        if (canary !== undefined && call.system.includes(canary)) rec.canaryInPrompt = true;
      }
      try {
        const r = await inner.complete(call);
        rec.calls.push({ model: r.modelUsed, tokensIn: r.inTokens, tokensOut: r.outTokens });
        if (!classifier) rec.lastModel = r.modelUsed;
        return r;
      } catch (e) {
        // A failed call still cost something on Groq's side, but the provider never reveals the usage of a failed call: 0 tokens.
        const models = configuredModels();
        if (!(e instanceof ProviderError && e.kind === 'config') && models) rec.calls.push({ model: models[call.tier], tokensIn: 0, tokensOut: 0 });
        if (!classifier) rec.lastModel = null;
        throw e;
      }
    },
  };
}

/**
 * Harness arm: one `runTask` per case, exactly the route's pipeline, with a Groq provider. The request is a same-origin POST
 * from the case's own `x-real-ip` (the runner makes it unique). A fresh provider per case, so the circuit breaker of one
 * case never decides another. `c.memory` is not installed: persona facts are table-derived (kind + key), so a free-text
 * memory string cannot enter any prompt in this build and that red-team row has nothing to carry (see the handoff, I-100).
 */
export function makeLiveRun(arm: Arm, deps: LiveDeps = {}): RunFn {
  if (arm !== 'harness') throw new Error('makeLiveRun serves the harness arm; the baseline arm goes through callBaseline');
  stats = freshStats();
  // The instance-wide window is lifted (one eval run is many requests from this one process); the per-address window is not.
  const limiter = createRateLimiter({ limits: { perInstance: 1_000_000 } });
  const events = new Map<string, TelemetryLine>();
  setLogSink((line) => {
    const e = parseLine(line);
    if (e?.id !== undefined) events.set(e.id, e);
  });
  return async (c: EvalCase): Promise<Observation> => {
    if (!c.ip) throw new Error('case has no ip: the runner assigns a unique x-real-ip to every call');
    const seen = { rateLimited: false };
    const rec: Recorder = { calls: [], taskCalls: 0, classifierCalls: 0, lastTier: null, lastModel: null, canaryInPrompt: false };
    const provider = recording(createGroqProvider({ fetchFn: watchRateLimit(deps.fetchFn, seen) }), rec, getEvalCanary());
    const req = new Request(`https://rumi.eval${c.path}`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-real-ip': c.ip },
      body: JSON.stringify(c.body),
    });

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    let idUsed = false;
    // The first value is the request id of the telemetry line; every later one is a prompt nonce.
    const rand = (): string => (idUsed ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : ((idUsed = true), id));
    const started = performance.now();
    const res = await runTask(SPECS[c.task], req, { provider, limiter, rand });
    // The telemetry line was written before runTask returned.
    const event = events.get(id);
    events.delete(id);
    const latencyMs = Math.round(performance.now() - started);

    let body: unknown;
    try {
      body = JSON.parse(await res.text());
    } catch {
      body = { error: { code: 'unparsable' } };
    }
    const degraded = typeof body === 'object' && body !== null && (body as { degraded?: unknown }).degraded === true;
    // The provider only ever reports the configured GROQ_MODEL_* name (provider.test.ts), so this is that value; a fallback names no model.
    const modelUsed = degraded ? null : rec.lastModel;

    stats.requests += 1;
    stats.taskCalls += rec.taskCalls;
    stats.classifierCalls += rec.classifierCalls;
    stats.costMicroUsd += event?.costMicroUsd ?? 0;
    bump(stats.outcomes, event?.outcome ?? 'unknown');
    for (const code of event?.guardHits ?? []) bump(stats.guards, code);

    const obs: Observation = {
      status: res.status,
      degraded,
      attempts: rec.taskCalls,
      modelUsed,
      body,
      mode: event?.outcome === 'mock' ? 'mock' : 'live',
      tier: rec.lastTier,
      latencyMs,
      calls: rec.calls,
      promptVersion: SPECS[c.task].promptVersion,
      headers: scanHeaders(res.headers),
      canaryInPrompt: rec.canaryInPrompt,
    };
    // Groq refused (429) and the harness had to serve its fallback: that is a rate limit hitting the eval, not an answer.
    if (seen.rateLimited) {
      stats.rateLimited += 1;
      if (degraded) return rateLimitedObs(obs);
    }
    return obs;
  };
}

// ---------------------------------------------------------------- baseline arm

/** One ``` fence around JSON is accepted, as in the harness. Anything that is not a JSON object gives undefined. */
function parseObject(text: string): Record<string, unknown> | undefined {
  let t = text.trim();
  if (t.startsWith('```')) {
    const nl = t.indexOf('\n');
    t = nl === -1 ? '' : t.slice(nl + 1);
    if (t.endsWith('```')) t = t.slice(0, -3);
  }
  try {
    const v: unknown = JSON.parse(t);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const errorObs = (status: number, code: string, base: Omit<Observation, 'status' | 'body'>): Observation => ({ ...base, status, body: { error: { code } } });

/**
 * Baseline arm: the pinned call, ONE attempt, no harness. The only addition to the task sentence is the model-output
 * schema (the baseline's "same JSON schema", D34); Groq's JSON mode also requires the word JSON in the prompt.
 * A reply that is not a JSON object, or has no text, is a 200 with an empty body: scored as an on-task failure (E-13).
 */
export async function callBaseline(call: BaselineCall, c: EvalCase, deps: LiveDeps = {}): Promise<Observation> {
  if (call.reasoningEffort !== REASONING_EFFORT) throw new Error(`the provider sends reasoning effort ${REASONING_EFFORT}; the pin says ${call.reasoningEffort}`);
  const seen = { rateLimited: false };
  const provider = createGroqProvider({ fetchFn: watchRateLimit(deps.fetchFn, seen) });
  const models = configuredModels();
  const base = { degraded: false, attempts: 1, modelUsed: null, mode: 'live' as const, tier: call.tier };
  const started = performance.now();
  try {
    const r = await provider.complete({
      tier: call.tier,
      system: `${call.system}\nReply with JSON that matches this schema: ${JSON.stringify(call.jsonSchema)}`,
      user: call.user,
      temperature: call.temperature,
      maxOutputTokens: call.maxOutputTokens,
      signal: AbortSignal.timeout(BASELINE_TIMEOUT_MS),
    });
    const parsed = parseObject(r.text);
    return { ...base, status: 200, modelUsed: r.modelUsed, body: parsed ?? {}, latencyMs: Math.round(performance.now() - started), calls: [{ model: r.modelUsed, tokensIn: r.inTokens, tokensOut: r.outTokens }] };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    const kind = e instanceof ProviderError ? e.kind : 'http';
    const ran = kind !== 'config';
    const calls = ran && models ? [{ model: models[call.tier], tokensIn: 0, tokensOut: 0 }] : [];
    const common = { ...base, attempts: ran ? 1 : 0, latencyMs, calls };
    // An empty answer is a 200 whose body has nothing in it. The model name is the configured one, as for any answer.
    if (kind === 'empty') return { ...common, status: 200, modelUsed: models?.[call.tier] ?? null, body: {} };
    if (seen.rateLimited) return rateLimitedObs({ ...common, status: 0, body: null });
    return errorObs(kind === 'timeout' ? 504 : kind === 'config' ? 503 : 502, kind === 'config' ? 'config' : 'ai_unavailable', common);
  }
}
