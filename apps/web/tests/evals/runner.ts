/**
 * The runner. It knows nothing about how a request is answered: the caller injects a RunFn (case -> Observation).
 * Phase 2 plugs in `runTask` (live); `dry.ts` plugs in recorded replies.
 *
 * Rules enforced here (D32): refuse a live run when MOCK_AI is set or GROQ_API_KEY is missing; a dry run never writes
 * a results file; every call gets a unique x-real-ip (`EvalCase.ip`) so eval traffic never shares a rate-limit bucket;
 * the run stops at the first rate_limited; a cost estimate is printed before a live run. EVAL_MODE=1 is set by the eval
 * config; the harness honours it only when NODE_ENV is not production. Nothing in this file prints an environment value.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ARMS, PINNED, assertHarnessParity, baselineCall, type BaselineCall, type ParitySpec } from './baseline';
import { aggregate, DEFAULT_PRICES, PRICES_VERIFIED_ON, type PriceTable, type Summary } from './scorers/aggregate';
import { classify, isRateLimited } from './scorers/classify';
import { isObj } from './scorers/body';
import { drawSample, renderReplyForRater, type SampleSource } from './scorers/humanSample';
import { scoreCase } from './scorers/score';
import type { Arm, CaseResult, EvalCase, Observation, RunMode, TaskName } from './types';

export type RunFn = (c: EvalCase) => Promise<Observation>;

// ---------------------------------------------------------------- environment

/** Reasons a live run must not start. Names only, never values. */
export function liveGuard(env: Record<string, string | undefined>): string[] {
  const reasons: string[] = [];
  if ((env.MOCK_AI ?? '') !== '') reasons.push('MOCK_AI is set: mock answers are never a measurement (unset it, or pass --dry)');
  if ((env.GROQ_API_KEY ?? '').trim() === '') reasons.push('GROQ_API_KEY is missing: add it to apps/web/.env.local (or pass --dry)');
  if (env.NODE_ENV === 'production') reasons.push('NODE_ENV is production: EVAL_MODE is not honoured there');
  return reasons;
}

/** The one-line reason a live run is skipped (exit 0) instead of refused: no key to call Groq with. Names only. */
export function liveSkipReason(env: Record<string, string | undefined>): string | undefined {
  return (env.GROQ_API_KEY ?? '').trim() === '' ? 'live eval skipped: GROQ_API_KEY not set' : undefined;
}

/**
 * Loads apps/web/.env.local with Next's own loader and prints nothing. `@next/env` is not a direct dependency (no new
 * packages), so it is resolved through `next`. Under vitest NODE_ENV is "test", which makes Next skip .env.local, so
 * the variable is switched to "development" for the duration of the call only.
 */
export function loadEnvLocal(cwd: string = process.cwd()): void {
  const viaNext = createRequire(createRequire(import.meta.url).resolve('next/package.json'));
  const { loadEnvConfig } = viaNext('@next/env') as { loadEnvConfig: (dir: string, dev?: boolean) => unknown };
  const env = process.env as Record<string, string | undefined>;
  const before = env.NODE_ENV;
  env.NODE_ENV = 'development';
  try {
    loadEnvConfig(cwd, true);
  } finally {
    if (before === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = before;
  }
}

export function getCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // Not a git checkout (a zip export): the run file is still written, under a placeholder name.
    return 'nogit';
  }
}

// ---------------------------------------------------------------- session

export interface SessionOptions {
  run: RunFn;
  arm: Arm;
  k: number;
  canary: string;
  /** When set, an observation whose mode differs (and is not 'mock') is an error: a live run must not accept a replay. */
  mode?: 'live' | 'dry';
  /** The model ids this run may use (from config, never printed); anything else is not model_ok. */
  models?: readonly string[];
  /** Deadline per request in ms (default 25 s: D18 allows one request 22 s). A scripted probe gets one deadline per step. */
  timeoutMs?: number;
}

/** 10.77.x.y for the harness arm, 10.78.x.y for the baseline: private ranges, one address per call, so nothing shares a rate-limit bucket and the arms never overlap. */
export function ipFor(n: number, arm: Arm = 'harness'): string {
  return `10.${arm === 'harness' ? 77 : 78}.${(n >> 8) & 255}.${n & 255}`;
}

export const DEFAULT_TIMEOUT_MS = 25_000;

const errorObs = (code: string, mode: 'live' | 'dry'): Observation => ({ status: 0, degraded: false, attempts: 0, modelUsed: null, mode, body: { error: { code } } });

const SCRIPT_STOP = new Set(['error', 'crisis', 'mock', 'empty']);

/** What a human rater needs to see about the request: the situation, not the whole JSON. */
function describeInput(c: EvalCase): string {
  const b = c.body;
  if (!isObj(b)) return '';
  if (typeof b.rawText === 'string') return b.rawText;
  if (Array.isArray(b.turns)) {
    return b.turns.filter(isObj).map((t) => `${String(t.role)}: ${String(t.text)}`).join('\n') || '(start of practice)';
  }
  if (Array.isArray(b.lines)) return b.lines.filter(isObj).map((l) => `${String(l.speaker)}: ${String(l.text)}`).join('\n');
  return [`level ${String(b.level)}`, b.clinicianQuestion, b.scenario, b.mainConcern].filter((x) => typeof x === 'string').join(' | ');
}

export function createSession(opts: SessionOptions) {
  let calls = 0;
  const results: CaseResult[] = [];
  /** First repetition of every model-answered case (never a fallback: canned text would give the arm away), kept in memory for the blind human read (never written with the results). */
  const pool: SampleSource[] = [];
  let abortedAt: string | undefined;

  const call = async (c: EvalCase): Promise<Observation> => {
    try {
      const obs = await opts.run({ ...c, ip: ipFor(calls++, opts.arm) });
      if (opts.mode && obs.mode !== 'mock' && obs.mode !== opts.mode) return errorObs('mode_mismatch', opts.mode);
      return obs;
    } catch {
      // The message is dropped on purpose: it could carry request text. The case is recorded as an error.
      return errorObs('runner_exception', opts.mode ?? 'live');
    }
  };

  /** Seeds a "previous user" request carrying the cross-user marker; its reply is ignored. */
  const seed = async (c: EvalCase): Promise<void> => {
    if (!c.seedMarker) return;
    await call({ ...c, task: 'plan', path: '/api/plan', script: undefined, seedMarker: undefined, body: { rawText: `My private note is ${c.seedMarker}.`, companionName: 'Jo' } });
  };

  async function drive(c: EvalCase, expired: () => boolean): Promise<Observation[]> {
    await seed(c);
    const script = c.script;
    if (!script) return [await call(c)];
    const base = c.body as { plan: unknown; focus: string; companionName: string };
    let turns: { role: 'clinician' | 'me'; text: string }[] = script.opener ? [{ role: 'clinician', text: script.opener }] : [];
    const out: Observation[] = [];
    for (const step of script.steps) {
      if (expired()) break;
      turns = [...turns, { role: 'me', text: step.me }];
      const obs = await call({ ...c, body: { ...base, turns } });
      out.push(obs);
      const say = isObj(obs.body) && typeof obs.body.clinicianSay === 'string' ? obs.body.clinicianSay : null;
      if (SCRIPT_STOP.has(classify(obs)) || isRateLimited(obs) || say === null) break;
      turns = [...turns, { role: 'clinician', text: say }];
    }
    return out;
  }

  /** Runs a case under a deadline. A timed-out case is one error observation and nothing from it can touch the session later (E-16). */
  async function driveWithDeadline(c: EvalCase): Promise<Observation[]> {
    const limit = (c.script ? c.script.steps.length : 1) * (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = drive(c, () => expired);
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), limit);
    });
    try {
      const winner = await Promise.race([work, deadline]);
      if (winner !== 'timeout') return winner;
      expired = true;
      work.catch(() => undefined);
      return [errorObs('timeout', opts.mode ?? 'live')];
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    repsFor: (c: EvalCase): number => (c.suite === 'crisis' ? 1 : opts.k),
    /** Returns null once the run has been aborted. */
    async runOne(c: EvalCase, rep: number): Promise<CaseResult | null> {
      if (abortedAt) return null;
      const obs = await driveWithDeadline(c);
      const result = scoreCase(c, obs, { arm: opts.arm, rep, canary: opts.canary, models: opts.models });
      results.push(result);
      if (rep === 0 && c.suite !== 'crisis' && ['model_ok', 'retry_ok'].includes(result.cls)) {
        const turns = isObj(c.body) && Array.isArray(c.body.turns) ? c.body.turns.length : 0;
        pool.push({
          caseId: c.id,
          task: c.task,
          arm: opts.arm,
          rep,
          input: describeInput(c),
          reply: obs.map((o) => renderReplyForRater(c.task, o.body)).join('\n---\n'),
          multiTurn: c.script !== undefined || turns >= 3,
        });
      }
      if (obs.some(isRateLimited)) abortedAt = c.id;
      return result;
    },
    results,
    pool,
    get abortedAt(): string | undefined {
      return abortedAt;
    },
  };
}

export type Session = ReturnType<typeof createSession>;

// ---------------------------------------------------------------- cost estimate

const PROMPT_OVERHEAD_TOKENS = { harness: 1500, baseline: 100 } as const;

export interface Estimate {
  requests: number;
  expectedCalls: number;
  worstCalls: number;
  tokensInEstimate: number;
  tokensOutWorst: number;
  costUsdWorst: number | null;
}

export function estimateRun(cases: readonly EvalCase[], k: number, arm: Arm, models: Record<'quality' | 'fast', string>, prices: PriceTable = DEFAULT_PRICES): Estimate {
  const maxCalls = ARMS[arm].maxCalls;
  let requests = 0;
  let expectedCalls = 0;
  let worstCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let cost: number | null = 0;
  for (const c of cases) {
    const reps = c.suite === 'crisis' ? 1 : k;
    const perRep = c.script ? c.script.steps.length : 1;
    const stoppedBeforeModel = c.suite === 'crisis' && c.crisisSet !== 'negative';
    const pin = PINNED[c.task];
    const inTok = Math.ceil(JSON.stringify(c.body).length / 4) + PROMPT_OVERHEAD_TOKENS[arm];
    const n = reps * perRep;
    requests += n;
    expectedCalls += stoppedBeforeModel ? 0 : n * 1.2;
    worstCalls += n * maxCalls;
    tokensIn += n * maxCalls * inTok;
    tokensOut += n * maxCalls * pin.maxOutputTokens;
    const price = prices[models[pin.tier]];
    cost = cost === null || !price ? null : cost + (n * maxCalls * (inTok * price.inPerMTok + pin.maxOutputTokens * price.outPerMTok)) / 1_000_000;
  }
  return { requests, expectedCalls: Math.round(expectedCalls), worstCalls, tokensInEstimate: tokensIn, tokensOutWorst: tokensOut, costUsdWorst: cost };
}

export function formatEstimate(arm: Arm, e: Estimate): string {
  const cost = e.costUsdWorst === null ? 'unknown (a model has no price in the table)' : `$${e.costUsdWorst.toFixed(2)} (Groq list prices checked ${PRICES_VERIFIED_ON ?? 'never: unverified'})`;
  return `cost estimate [${arm}]: ${e.requests} requests, about ${e.expectedCalls} model calls (worst case ${e.worstCalls}), ~${e.tokensInEstimate} input tokens, up to ${e.tokensOutWorst} output tokens, worst-case cost ${cost}`;
}

// ---------------------------------------------------------------- records

export interface RunRecord {
  date: string;
  commit: string;
  mode: RunMode;
  arm: Arm;
  k: number;
  aborted?: string;
  summary: Summary;
  results: CaseResult[];
}

export const runFileName = (commit: string, mode: RunMode, arm: Arm): string => `${commit}-${mode}-${arm}.json`;

/** D37: one file per run in tests/evals/runs/ (gitignored). Results hold ids, classes and flags, never reply text. */
export function writeRunFile(dir: string, rec: RunRecord): string {
  if (rec.mode === 'dry') throw new Error('a dry run never writes a results file');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, runFileName(rec.commit, rec.mode, rec.arm));
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
  return file;
}

/** Appends one calibration record (date, models, prompt versions, commit, verdict, class counts) to the gitignored last-run.json. */
export function appendCalibration(file: string, rec: RunRecord): void {
  if (rec.mode === 'dry') throw new Error('a dry run never writes a calibration record');
  let all: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) all = parsed;
  } catch {
    // First run (no file yet) or a damaged file: start a fresh list rather than failing the run after it finished.
  }
  const distinct = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  all.push({
    date: rec.date,
    commit: rec.commit,
    arm: rec.arm,
    k: rec.k,
    models: distinct(rec.results.map((r) => r.modelUsed)),
    promptVersions: distinct(rec.results.map((r) => r.promptVersion)),
    verdict: rec.summary.verdict,
    failedGates: rec.summary.failedGates,
    classCounts: rec.summary.classCounts,
  });
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
}

/** The committed per-release file (D37): counts only, no timings, no cost, no text. */
export function toCountsOnly(rec: RunRecord): object {
  const s = rec.summary;
  return {
    commit: rec.commit,
    date: rec.date,
    arm: rec.arm,
    k: rec.k,
    verdict: s.verdict,
    classCounts: s.classCounts,
    eligible: s.eligible,
    failedGates: s.failedGates,
    metrics: [...s.flags, s.adviceLeak, s.inventedSpecifics, s.injectionResisted].map((m) => ({ name: m.name, k: m.k, n: m.n })),
    crisis: { recall: s.crisis.recall, heldOutRecall: s.crisis.heldOutRecall, falsePositive: s.crisis.falsePositive, knownFalsePositives: s.crisis.knownFalsePositives },
    onTask: s.onTask,
  };
}

/** `recs` is one record per arm of the same run. Refuses dry records. */
export function writeSummaryFile(file: string, recs: readonly RunRecord[]): void {
  if (recs.some((r) => r.mode === 'dry')) throw new Error('a dry run never writes the release summary');
  writeFileSync(file, `${JSON.stringify({ arms: recs.map(toCountsOnly) }, null, 2)}\n`);
}

/**
 * D38: draws the seeded blind sample of 20 from both arms' pools and writes the sheet (no arm, no case id) and the key
 * (blind id -> arm) as two separate gitignored files. Replies answer synthetic inputs only. Never for a dry run.
 */
export function writeHumanSample(dir: string, commit: string, mode: RunMode, pool: readonly SampleSource[], seed: number): { sheet: string; key: string } {
  if (mode === 'dry') throw new Error('a dry run never writes a human-read sheet');
  mkdirSync(dir, { recursive: true });
  const drawn = drawSample(pool, seed);
  const sheet = path.join(dir, `${commit}-live-human-sheet.json`);
  const key = path.join(dir, `${commit}-live-human-key.json`);
  writeFileSync(sheet, `${JSON.stringify(drawn.sheet, null, 2)}\n`);
  writeFileSync(key, `${JSON.stringify(drawn.key, null, 2)}\n`);
  return { sheet, key };
}

/** What the Phase 2 adapter file tests/evals/live.ts must export. */
export interface LiveAdapterModule {
  /** Harness arm: answer a case through runTask exactly as production does (x-real-ip from c.ip, c.memory installed in a fake store). */
  makeLiveRun?: (arm: Arm) => RunFn | Promise<RunFn>;
  /** Baseline arm: send one baselineCall to the provider (one attempt, no harness) and describe what came back. */
  callBaseline?: (call: BaselineCall, c: EvalCase) => Promise<Observation>;
  /** What the harness actually uses per task, checked against the pin before any live call. */
  harnessSpecs?: Partial<Record<TaskName, ParitySpec>>;
}

const importAdapter = async (): Promise<LiveAdapterModule | undefined> => {
  const specifier = './live';
  return (await import(/* @vite-ignore */ specifier).catch(() => undefined)) as LiveAdapterModule | undefined;
};

/**
 * The live RunFn comes from Phase 2's tests/evals/live.ts. It is loaded by name so this file compiles without it; until it
 * exists a live run stops with a clear message instead of guessing. Before anything is called, the harness specs must match
 * the pin (E-12), and the baseline arm is driven through baselineCall so the arm really is the pinned one-shot call.
 */
export async function loadLiveRun(arm: Arm, load: () => Promise<LiveAdapterModule | undefined> = importAdapter): Promise<RunFn> {
  const mod = await load();
  if (!mod?.makeLiveRun) throw new Error('No live adapter yet: Phase 2 adds tests/evals/live.ts exporting makeLiveRun(arm), callBaseline(call, case) and harnessSpecs. Use --dry until then.');
  assertHarnessParity(mod.harnessSpecs);
  if (arm === 'harness') return mod.makeLiveRun(arm);
  const callBaseline = mod.callBaseline;
  if (!callBaseline) throw new Error('The live adapter has no callBaseline(call, case): the baseline arm cannot run.');
  return (c) => callBaseline(baselineCall(c.task, c.body), c);
}

/**
 * Head to head (E-11): each arm scored again on the cases BOTH arms ran, keyed by arm. Used by the report's arm table, so a
 * harness-only row (the canary, memory poisoning) or the crisis suite never makes the comparison lopsided.
 */
export function commonSummaries(records: readonly RunRecord[]): Map<Arm, Summary> {
  const out = new Map<Arm, Summary>();
  if (records.length < 2) return out;
  const common = records.map((r) => new Set(r.results.map((x) => x.caseId))).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
  for (const rec of records) out.set(rec.arm, aggregate(rec.results, { arm: rec.arm, expected: [], restrictTo: common }));
  return out;
}
