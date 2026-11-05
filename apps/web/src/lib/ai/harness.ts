/**
 * runTask: the one request pipeline behind /api/plan, /api/practice, /api/sayit and /api/recap.
 * The order of the stages is a contract (06 section 4, 07 D2 D5 D7 D18 D19 D43, 08 sections 1 to 5), and tests pin it:
 *
 *   guardRequest (origin, session, per-instance limits, declared size, key format)
 *   -> requireUser (optional by default: a signed-out caller is served and limited by address; "required" gives 401)
 *   -> readJson with a byte cap -> Zod request schema
 *   -> every string leaf through promptForm into a clone (the parsed body is never changed) -> schema again (I-044)
 *   -> crisis check on spec.crisisFields (tier "certain": card; tier "check": one cheap model call, fail safe)
 *   -> kill-switch (ops_feature_flags ai_enabled) and global spend cap: either one means the fallback, no provider call
 *   -> PII redaction and injection count -> configuration check -> MOCK_AI shortcut
 *   -> stated preferences from persona_facts (signed in only) -> shared cache (user-independent say-it) and per-user reply cache: a hit is answered here
 *   -> single-flight on the request (and x-idempotency-key): identical in-flight requests share one computation
 *   -> daily usage limit (Supabase counters) -> ledger -> prompt (nonce regions, canary)
 *   -> provider calls (at most 3, 22 s) -> output guards (model crisis flag before Zod, Zod, links, advice, task rules)
 *   -> finalize -> reply schema -> on any hard failure or a provider that is down: spec.fallback with degraded:true
 *   -> one telemetry call (codes and counts only) -> JSON answer, no-store, x-request-id, session cookie appended.
 * With MOCK_AI=1 nothing touches Supabase: no auth lookup, no flags, no limits, no caches.
 *
 * Nothing the user typed, nothing from memory and no key is ever written to a log line or an error body.
 */
import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { AppError, toResponse } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/requestContext";
import { recordAiEvent, recordAppEvent } from "@/lib/telemetry/sinks";
import { getMemoryFacts } from "@/features/memory/supabaseStore";
import { COMPANION_RE, LIMITS } from "@/features/shared/constants";
import { isHard, type GuardCode } from "@/features/shared/guards";
import type { EvidenceLedger, TaskSpec, Tier } from "@/features/shared/task";
import { crisisTier } from "@/lib/crisis";
import { ConfigError, aiForceOff, assertRuntimeEnv, getEvalCanary, isVercelProduction, mockAiEnabled, mockOutsideLocalDev } from "@/lib/env";
import { HttpError, json, readJson, retryAfter } from "./http";
import { CANONICAL_COMPANION, replyCache, replyKey, requestDigest, cacheKey, sharedCache, sharedCacheKey, singleFlight } from "./cache";
import { getFlag } from "./flags";
import { bucketOf, checkAndBump, costMicroUsd, recordSpend, spendCapReached, type LimitVerdict } from "./limits";
import { adviceCodes, claimsHumanCodes, clinicianFindingCodes, collectStrings, mapStrings, stripUrls } from "./guards/output";
import { promptForm, redactPii, scanInjection } from "./guards/input";
import { buildCrisisCheckPrompt, canaryLine, containsCanary, fence, newNonce } from "./prompt";
import { ProviderError, createGroqProvider, toStrictJsonSchema, type JsonSchemaSpec, type Provider, type ProviderCall, type ProviderResult } from "./provider";
import type { AiEvent, CrisisSource, EventErrorCode, Stage } from "./telemetry";
import { guardRequest } from "@/lib/security/guardRequest";
import type { RateLimiter } from "@/lib/security/rateLimit";


export interface SignedIn {
  userId: string;
  userHash: string;
  isAnonymous: boolean;
}

export interface HarnessDeps {
  /** Tests inject a fake. Without it the Groq provider is used (and not at all in MOCK_AI mode). */
  provider?: Provider;
  limiter?: RateLimiter;
  now?: () => number;
  /** Source of the prompt nonce (12 hex characters). */
  rand?: () => string;
  /** "optional" (default): a caller who is not signed in is served and limited by address. "required": 401. */
  auth?: "optional" | "required";
  requireUser?: (req: Request) => Promise<SignedIn>;
  getFlag?: typeof getFlag;
  spendCapReached?: () => Promise<boolean>;
  checkAndBump?: typeof checkAndBump;
  /** Records the day's spend and returns the promise that writes it. The harness hands that promise to `defer`. */
  recordSpend?: (costMicroUsd: number) => Promise<void> | void;
  /** Keeps work alive after the response (next/server after()). Tests inject a spy. */
  defer?: (work: Promise<unknown>) => void;
  record?: typeof recordAiEvent;
  getMemoryFacts?: (userId: string) => Promise<string[]>;
  /** Pause before the tier swap. Tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>;
}

/** One deadline per request, a cap per call, and a pause so the fallback always has time to answer (07 D18). */
const DEADLINE_MS = 22_000;
const CALL_MAX_MS = 10_000;
const RESERVE_MS = 1_000;
const MAX_CALLS = 3;
const BREAKER_FAILS = 3;
const BREAKER_PAUSE_MS = 30_000;
/** A 429 without a usable Retry-After keeps that tier out of use for this long; with one, for that long, never more than the cap. */
const COOLDOWN_DEFAULT_MS = 2_000;
const COOLDOWN_MAX_MS = 60_000;
/** Jittered pause before the tier swap, so many requests that failed together do not retry together. */
const SWAP_PAUSE_MIN_MS = 100;
const SWAP_PAUSE_SPREAD_MS = 200;
/** The tier 2 crisis question needs a one-word answer; the cap is for the reasoning tokens of a small model. */
const CLASSIFY_MAX_TOKENS = 400;
const MAX_MODEL_TEXT = 100_000;
/** The crisis classifier sees at most this many characters (the regex tiers already saw all of the text). */
const CLASSIFY_INPUT_CHARS = 400;
/** The persona-facts read gives up after this long; the harness does not trust the store to do it. */
const MEMORY_MS = 1_500;
/** The auth lookup is an outbound call, so it has its own deadline. Past it the caller counts as signed out. */
const AUTH_MS = 2_000;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Keys whose values are ids or enum values (checked by Zod): never redacted, scanned or stripped as free text. */
const ID_KEYS = new Set(["id", "itemId", "planId", "evidence", "coveredItemIds", "createdAt", "companionName", "kind", "source", "role", "focus", "speaker", "mySpeaker", "scenario", "section", "status"]);
const isIdKey = (key: string): boolean => ID_KEYS.has(key);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const otherTier = (t: Tier): Tier => (t === "quality" ? "fast" : "quality");
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline")), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ClassifierAnswer = z.object({ crisis: z.boolean() });
const CLASSIFIER_SCHEMA: JsonSchemaSpec = { name: "crisis_check", schema: toStrictJsonSchema(ClassifierAnswer) };

/** The strict JSON schema of a spec's model output, built once. undefined (JSON-object mode) if Zod cannot express it. */
const schemas = new WeakMap<object, JsonSchemaSpec | null>();
function schemaOf(spec: { name: string; modelOut: z.ZodType }): JsonSchemaSpec | undefined {
  let s = schemas.get(spec);
  if (s === undefined) {
    try {
      s = { name: `${spec.name}_reply`, schema: toStrictJsonSchema(spec.modelOut) };
    } catch {
      // A schema Zod cannot turn into JSON schema: this task runs in JSON-object mode, and our Zod check still decides.
      s = null;
    }
    schemas.set(spec, s);
  }
  return s ?? undefined;
}

// ---------------------------------------------------------------- the provider, its circuit breaker and tier cooldowns

let groq: Provider | undefined;
const defaultProvider = (): Provider => (groq ??= createGroqProvider());

interface Breaker {
  fails: number;
  openUntil: number;
  /** True while the one probe call after a pause is in flight: every other request stays on the fallback. */
  probing: boolean;
  /** Per tier: do not call this tier before this time (a 429 and its Retry-After). */
  cooldownUntil: Record<Tier, number>;
}
/** One breaker per provider object, so each serverless instance and each test provider has its own. */
const breakers = new WeakMap<Provider, Breaker>();
function breakerOf(p: Provider): Breaker {
  let b = breakers.get(p);
  if (b === undefined) {
    b = { fails: 0, openUntil: 0, probing: false, cooldownUntil: { quality: 0, fast: 0 } };
    breakers.set(p, b);
  }
  return b;
}

/** Runs one provider call with its own abort timer, so a provider that ignores the signal still cannot hang the request. */
async function withTimeout(provider: Provider, call: Omit<ProviderCall, "signal">, ms: number): Promise<ProviderResult> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new ProviderError("timeout"));
    }, ms);
  });
  try {
    return await Promise.race([provider.complete({ ...call, signal: ac.signal }), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

const ProviderAnswer = z.object({ text: z.string().min(1), inTokens: z.number(), outTokens: z.number(), cachedTokens: z.number().optional(), modelUsed: z.string().optional(), finishReason: z.string().optional() });

/** Why no provider answer was produced. 'skipped': breaker open, tier cooling down, deadline or call budget used up. */
type CallFailure = ProviderError["kind"] | "skipped";
type CallOutcome = { ok: true; result: ProviderResult } | { ok: false; kind: CallFailure; status?: number; code?: string };

/** The telemetry event while the request runs: the same fields, but the guard hits can still be added to. */
type LiveEvent = Omit<AiEvent, "guardHits"> & { guardHits: GuardCode[] };

interface Run {
  now: () => number;
  startedAt: number;
  calls: number;
  ev: LiveEvent;
  /** Spend and cache counts for this request's own provider calls. */
  costMicro: number;
  cachedTokens: number;
  log: ReturnType<typeof createLogger>;
}

/** A call that was sent and failed without an answer may still have been billed for its input: count a rough estimate (4 characters a token). */
const estimateInputTokens = (call: { system: string; user: string }): number => Math.ceil((call.system.length + call.user.length) / 4);

function modelNameOf(provider: Provider, tier: Tier): string {
  try {
    return provider.model(tier);
  } catch {
    // No usable model name: the price table then uses its safe default (the larger model).
    return "";
  }
}

const tierCooling = (p: Provider, tier: Tier, now: number): boolean => breakerOf(p).cooldownUntil[tier] > now;

/** The only place a provider is called. Enforces the call cap, the deadline, the breaker, tier cooldowns and the counts. */
async function callProvider(run: Run, provider: Provider | undefined, call: Omit<ProviderCall, "signal">): Promise<CallOutcome> {
  if (provider === undefined) return { ok: false, kind: "config" };
  const breaker = breakerOf(provider);
  const left = DEADLINE_MS - (run.now() - run.startedAt);
  const budget = Math.min(CALL_MAX_MS, left - RESERVE_MS);
  // Open: wait out the pause. After the pause exactly one request (the probe) goes through; the rest stay on the fallback.
  const wasOpen = breaker.openUntil > 0;
  if (run.calls >= MAX_CALLS || breaker.openUntil > run.now() || (wasOpen && breaker.probing) || tierCooling(provider, call.tier, run.now()) || budget <= 0) {
    return { ok: false, kind: "skipped" };
  }

  run.calls += 1;
  run.ev.attempts = run.calls;
  run.ev.tier = call.tier;
  if (wasOpen) breaker.probing = true;
  try {
    const answer = await withTimeout(provider, call, budget);
    const valid = ProviderAnswer.safeParse(answer);
    if (!valid.success) throw new ProviderError("empty");
    breaker.fails = 0;
    breaker.openUntil = 0;
    const inTokens = Math.max(0, Math.floor(answer.inTokens));
    const outTokens = Math.max(0, Math.floor(answer.outTokens));
    const cached = Math.min(inTokens, Math.max(0, Math.floor(answer.cachedTokens ?? 0)));
    run.ev.inTokens += inTokens;
    run.ev.outTokens += outTokens;
    run.ev.finishReason = answer.finishReason;
    run.cachedTokens += cached;
    run.costMicro += costMicroUsd(answer.modelUsed ?? "", inTokens, cached, outTokens);
    return { ok: true, result: answer };
  } catch (e) {
    // Anything that is not a ProviderError is a bug in a provider; it counts as a failed call like any other.
    const kind = e instanceof ProviderError ? e.kind : "http";
    const status = e instanceof ProviderError ? e.status : undefined;
    run.ev.providerError = kind;
    run.ev.providerStatus = status;
    // A config problem or an abort never reached the vendor; a 4xx is a problem with our request, not with the vendor's health.
    if (kind !== "config" && kind !== "aborted" && kind !== "rejected") {
      breaker.fails += 1;
      if (breaker.fails >= BREAKER_FAILS) {
        breaker.openUntil = run.now() + BREAKER_PAUSE_MS;
        run.log.warn("breaker_opened", { kind, ...(status === undefined ? {} : { status }) });
      }
    }
    // Sent but unanswered (timeout, network, 5xx, empty): the vendor may still bill the input.
    if (kind === "timeout" || kind === "http" || kind === "empty") {
      run.costMicro += costMicroUsd(modelNameOf(provider, call.tier), estimateInputTokens(call), 0, 0);
    }
    if (kind === "rate_limited") {
      const wait = e instanceof ProviderError && e.retryAfterSec !== undefined ? e.retryAfterSec * 1000 : COOLDOWN_DEFAULT_MS;
      breaker.cooldownUntil[call.tier] = run.now() + Math.min(wait, COOLDOWN_MAX_MS);
    }
    return { ok: false, kind, status, code: e instanceof ProviderError ? e.code : undefined };
  } finally {
    if (wasOpen) breaker.probing = false;
  }
}

// ---------------------------------------------------------------- model text

/** JSON.parse that accepts one ``` fence around the JSON and drops a __proto__ key. undefined when it is not JSON. */
function parseModelJson(text: string): unknown {
  if (text.length > MAX_MODEL_TEXT) return undefined;
  let body = text.trim();
  if (body.startsWith("```")) {
    const firstLine = body.indexOf("\n");
    body = firstLine === -1 ? "" : body.slice(firstLine + 1);
    body = body.endsWith("```") ? body.slice(0, -3) : body;
  }
  try {
    return JSON.parse(body, (key, value: unknown) => (key === "__proto__" ? undefined : value));
  } catch {
    // Not JSON: the caller records the hard code "schema" and retries.
    return undefined;
  }
}

/**
 * Tier 2 (07 D43). The call is metered first (its own daily counters per address and per user): when they are used up the
 * answer is the crisis card, never a 429. A failed call, an unreadable answer or a wrong shape also mean the card.
 * `source` says why, for the event only (a fixed list, never text).
 */
async function modelSaysCrisis(
  run: Run,
  provider: Provider | undefined,
  nonce: string,
  text: string,
  quota: () => Promise<LimitVerdict>,
): Promise<{ crisis: boolean; source: CrisisSource }> {
  let verdict: LimitVerdict;
  try {
    verdict = await quota();
  } catch {
    // The meter itself broke: do not guess, show the card (fail safe).
    return { crisis: true, source: "failsafe_error" };
  }
  if (!verdict.ok) return { crisis: true, source: "failsafe_quota" };
  const prompt = buildCrisisCheckPrompt(nonce, text.slice(0, CLASSIFY_INPUT_CHARS));
  const call = await callProvider(run, provider, { tier: "fast", ...prompt, temperature: 0, maxOutputTokens: CLASSIFY_MAX_TOKENS, jsonSchema: CLASSIFIER_SCHEMA });
  if (!call.ok) return { crisis: true, source: "failsafe_error" };
  const answer = ClassifierAnswer.safeParse(parseModelJson(call.result.text));
  if (!answer.success) return { crisis: true, source: "failsafe_error" };
  return { crisis: answer.data.crisis, source: "model_yes" };
}

/** True when the model text looks cut off rather than wrong: the vendor said "length", or it is not JSON and does not end like JSON. */
const looksCut = (text: string, finish: string | undefined): boolean => finish === "length" || (parseModelJson(text) === undefined && !/[}\]]\s*(?:```)?\s*$/.test(text.trim()));

/** Every string the user (or the browser, which is the same thing to us) supplied, except the pretend clinician's own turns. */
function userLeaves(r: unknown): string[] {
  const view = isRecord(r) && Array.isArray(r.turns) ? { ...r, turns: r.turns.filter((t) => !(isRecord(t) && t.role === "clinician")) } : r;
  return collectStrings(view, isIdKey);
}

type Verdict<Reply> = { kind: "crisis" } | { kind: "checked"; codes: GuardCode[]; reply?: Reply };

const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];

/** Everything between the model's text and a reply the user may see. Returns codes only, never text. */
function checkOutput<Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, r: Req, ledger: EvidenceLedger, text: string, canary: string | undefined): Verdict<Reply> {
  const raw = parseModelJson(text);
  if (isRecord(raw) && raw.crisis === true) return { kind: "crisis" }; // D5: read before Zod, so a reply of only {"crisis":true} counts
  if (canary !== undefined && containsCanary(text, canary)) return { kind: "checked", codes: ["schema"] };
  const parsed = spec.modelOut.safeParse(raw);
  if (!parsed.success) return { kind: "checked", codes: ["schema"] };

  const out = mapStrings(parsed.data, stripUrls, isIdKey);
  if (!spec.modelOut.safeParse(out).success) return { kind: "checked", codes: ["empty"] };

  const codes: GuardCode[] = [];
  for (const s of collectStrings(out, isIdKey)) {
    if (spec.adviceGuard) codes.push(...adviceCodes(s, ledger));
    // Only the pretend clinician is held to these. A say-it script may say "I am a nurse" about the user themselves.
    if (spec.name === "practice") codes.push(...clinicianFindingCodes(s, ledger), ...claimsHumanCodes(s));
  }
  codes.push(...spec.validate(r, out, ledger));
  const all = unique(codes);
  if (all.some(isHard)) return { kind: "checked", codes: all };

  try {
    const reply = spec.reply.safeParse({ ...(spec.finalize(r, out, ledger) as object), degraded: false });
    return reply.success ? { kind: "checked", codes: all, reply: reply.data } : { kind: "checked", codes: [...all, "schema"] };
  } catch {
    // finalize is pure and should not throw; if it does, that attempt is a failed attempt like any other.
    return { kind: "checked", codes: [...all, "schema"] };
  }
}

// ---------------------------------------------------------------- the request

/**
 * Stated preferences for a signed-in user, read on the server from persona_facts (08 section 3: getMemoryFacts never throws,
 * gives up after 1.5 s and returns []; the harness enforces that deadline itself). Facts a browser sends in the body are never
 * used. A signed-out caller has none.
 */
async function memoryStrings(useMemory: boolean, userId: string | null, read: (userId: string) => Promise<string[]>): Promise<string[]> {
  if (!useMemory || userId === null) return [];
  try {
    const facts = await within(read(userId), MEMORY_MS);
    return Array.isArray(facts) ? facts.filter((f): f is string => typeof f === "string" && f.trim() !== "").slice(0, LIMITS.factsMax) : [];
  } catch {
    // The contract says this never throws; if a broken store does, the request goes on without preferences (they only adapt wording).
    return [];
  }
}

function companionOf(r: unknown): string {
  const name = isRecord(r) ? r.companionName : undefined;
  return typeof name === "string" && COMPANION_RE.test(name) ? name : CANONICAL_COMPANION;
}

/** One app event per instance, so a deployment that serves canned answers is visible without flooding the table. */
let mockAnnounced = false;
function announceMock(task: string): void {
  if (mockAnnounced) return;
  mockAnnounced = true;
  recordAppEvent({ source: "server", area: "app", code: "mock_ai_active", route: `/api/${task}` });
}

/** Tests only: the next mock request announces itself again. */
export function resetMockAnnouncementForTest(): void {
  mockAnnounced = false;
}

/** next/server after(): the work is awaited after the response. Outside a request (scripts, unit tests) there is nothing to extend. */
function deferToAfter(work: Promise<unknown>): void {
  try {
    after(() => work);
  } catch {
    // Not inside a request scope: the promise simply runs on its own.
  }
}

const withDegraded = (reply: unknown, degraded: boolean): unknown => ({ ...(reply as object), degraded });

/** What the work of one request produced. Shared by every request that joined the same computation. */
type Done = { kind: "crisis"; source: CrisisSource } | { kind: "reply"; reply: unknown; outcome: "ok" | "mock" } | { kind: "degraded"; reply: unknown; code: EventErrorCode };

type CacheStatus = "miss" | "hit" | "bypass";

export async function runTask<Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, req: Request, deps: HarnessDeps = {}): Promise<Response> {
  const now = deps.now ?? Date.now;
  const rand = deps.rand ?? newNonce;
  const sleep = deps.sleep ?? defaultSleep;
  const headerId = req.headers.get(REQUEST_ID_HEADER);
  const requestId = headerId !== null && REQUEST_ID_RE.test(headerId) ? headerId : newRequestId();
  const log = createLogger({ requestId, route: `/api/${spec.name}` });
  const defer = deps.defer ?? deferToAfter;
  const run: Run = {
    now,
    startedAt: now(),
    calls: 0,
    costMicro: 0,
    cachedTokens: 0,
    log,
    ev: {
      id: requestId,
      task: spec.name,
      promptVersion: spec.promptVersion,
      outcome: "error",
      degraded: false,
      attempts: 0,
      tier: "none",
      redactions: 0,
      injectionHits: 0,
      thin: false,
      guardHits: [],
      memoryItems: 0,
      inTokens: 0,
      outTokens: 0,
      ms: 0,
    },
  };
  const ev = run.ev;
  let stage: Stage = "guard";
  let cookie: string | null = null;
  let ipHash = "0000000000000000";
  let user: SignedIn | null = null;
  let cacheStatus: CacheStatus = "bypass";
  let mockHeader = false;
  /** The sanitized request, once it exists. The fallback and the mock use it (not the redacted copy). */
  let clean: Req | undefined;

  const finish = (res: Response): Response => {
    ev.ms = Math.max(0, now() - run.startedAt);
    res.headers.set(REQUEST_ID_HEADER, requestId);
    // The cache header is for operators and tests; on a production deployment it is not sent.
    if (!isVercelProduction()) res.headers.set("x-rumi-cache", cacheStatus);
    if (mockHeader) res.headers.set("x-rumi-mock", "1");
    if (cookie !== null) res.headers.append("Set-Cookie", cookie);
    try {
      // A crisis event carries no bucket: nothing may tie a crisis to a person or an address.
      const bucket = ev.outcome === "crisis" ? {} : { bucket: bucketOf(user === null ? null : user.userHash, ipHash) };
      (deps.record ?? recordAiEvent)(ev, { cacheStatus, cachedTokens: run.cachedTokens, ...bucket });
    } catch {
      // Telemetry never blocks or fails an answer. recordAiEvent swallows its own failures; this is for a broken injected sink.
    }
    if (run.costMicro > 0) {
      try {
        // The write to the global bucket is awaited by after()/waitUntil, so it is not lost when the instance freezes.
        const write = (deps.recordSpend ?? recordSpend)(run.costMicro);
        if (write !== undefined) defer(write);
      } catch {
        // Cost accounting is best effort; the per-request telemetry above already carries the token counts.
      }
    }
    return res;
  };

  /** The deterministic AI-down answer. Throws HttpError(503) if even this cannot be built. */
  const degrade = (code: EventErrorCode): Done => {
    const parsed = spec.reply.safeParse(withDegraded(spec.fallback(clean as Req), true));
    if (!parsed.success) throw new HttpError(503, "ai_unavailable");
    return { kind: "degraded", reply: parsed.data, code };
  };
  const replyDone = (reply: unknown, outcome: "ok" | "mock"): Done | undefined => {
    const parsed = spec.reply.safeParse(withDegraded(reply, false));
    return parsed.success ? { kind: "reply", reply: parsed.data, outcome } : undefined;
  };
  const respond = (done: Done): Response => {
    if (done.kind === "crisis") {
      ev.outcome = "crisis";
      ev.crisisSource = done.source;
      cacheStatus = "bypass";
      return json({ crisis: true });
    }
    if (done.kind === "reply") {
      ev.outcome = done.outcome;
      return json(done.reply);
    }
    ev.outcome = "fallback";
    ev.degraded = true;
    ev.errorCode = done.code;
    cacheStatus = "bypass";
    return json(done.reply);
  };
  const failure = (e: HttpError | AppError): Response => {
    const app = e instanceof AppError ? e : new AppError(e.code);
    ev.outcome = "error";
    ev.degraded = false;
    ev.errorCode = app.code as EventErrorCode;
    cacheStatus = "bypass";
    if (app.status >= 500) log.error("ai_request_failed", app, { stage });
    const res = toResponse(app, requestId);
    if (app.status !== 429) return res;
    const headers = new Headers(res.headers);
    headers.set("Retry-After", String(retryAfter(e instanceof HttpError ? e.retryAfterSec : undefined)));
    return new Response(res.body, { status: res.status, headers });
  };

  try {
    // 1. same origin, session, limits, declared size, key format
    const guard = guardRequest(req, { limiter: deps.limiter, maxBytes: LIMITS.bodyBytesMax });
    cookie = guard.session.setCookie;
    ipHash = guard.ipHash;
    const mock = mockAiEnabled();
    if (mock && mockOutsideLocalDev()) {
      mockHeader = true;
      announceMock(spec.name);
    }

    // 2. who is asking. Signed out is allowed unless the route says "required"; auth being down counts as signed out.
    if (!mock) {
      stage = "auth";
      try {
        user = await within((deps.requireUser ?? requireUser)(req), AUTH_MS);
      } catch (e) {
        if (deps.auth === "required") throw e instanceof AppError ? e : new AppError("unauthorized");
        user = null;
      }
    }

    // 3. body with a byte cap, then the request schema
    stage = "body";
    const body = await readJson(req, LIMITS.bodyBytesMax);
    stage = "request";
    const parsed = spec.request.safeParse(body);
    if (!parsed.success) throw new HttpError(400, "bad_input");

    // 4. every string leaf cleaned into a clone; the schema runs again so text that is empty after cleaning is refused (I-044)
    stage = "sanitize";
    const sanitized = spec.request.safeParse(mapStrings(parsed.data, promptForm));
    if (!sanitized.success) throw new HttpError(400, "bad_input");
    const r = sanitized.data;
    clean = r;

    // 5. crisis: deterministic, before any model sees anything. Certain wins at once, even with AI switched off.
    //    The regex tier runs over every string the browser supplied (plan items, concern, transcript, the user's turns), not only
    //    the fresh field: text that skipped the fresh field must not reach a prompt. The model's opinion is only asked about fresh text.
    stage = "crisis";
    const fresh = Object.values(spec.crisisFields(r));
    const flagged: string[] = [];
    for (const text of fresh) {
      const tier = crisisTier(text);
      if (tier === "certain") return finish(respond({ kind: "crisis", source: "tier1" }));
      if (tier === "check") flagged.push(text);
    }
    for (const text of userLeaves(r)) {
      if (crisisTier(text) === "certain") return finish(respond({ kind: "crisis", source: "tier1" }));
    }

    // 6. kill-switch and spend cap. Either one means no provider call at all; a text that needs the model's opinion
    //    about crisis is then treated as a crisis (fail safe, same as a provider that is down).
    //    AI_FORCE_OFF=1 is the switch that needs no database. The persona facts are read in parallel with the flag lookups.
    let aiOff = false;
    let memoryRead: Promise<string[]> = Promise.resolve([]);
    if (!mock) {
      stage = "flags";
      memoryRead = memoryStrings(spec.useMemory, user === null ? null : user.userId, deps.getMemoryFacts ?? getMemoryFacts);
      aiOff = aiForceOff() || !(await (deps.getFlag ?? getFlag)("ai_enabled")) || (await (deps.spendCapReached ?? spendCapReached)());
    }
    const nonce = rand();
    const provider = deps.provider ?? (mock ? undefined : defaultProvider());
    if (flagged.length > 0) {
      stage = "provider";
      const text = redactPii(flagged.join("\n")).text;
      if (aiOff) return finish(respond({ kind: "crisis", source: "failsafe_off" }));
      const quota = (): Promise<LimitVerdict> =>
        (deps.checkAndBump ?? checkAndBump)({ userHash: user === null ? null : user.userHash, isAnonymous: user === null ? true : user.isAnonymous, ipHash, task: "classify" });
      const asked = await modelSaysCrisis(run, provider, nonce, text, quota);
      if (asked.crisis) return finish(respond({ kind: "crisis", source: asked.source }));
    }
    if (aiOff) return finish(respond(degrade("ai_unavailable")));

    // 7. personal details out, injection counted (never blocked)
    stage = "redact";
    const redacted = mapStrings(
      r,
      (s) => {
        ev.injectionHits += scanInjection(s);
        const red = redactPii(s);
        if (red.tooLarge) throw new HttpError(413, "too_large");
        ev.redactions += red.count;
        return red.text;
      },
      isIdKey,
    );

    // 8. configuration, then the mock shortcut
    stage = "config";
    let configured = true;
    if (deps.provider === undefined) {
      try {
        assertRuntimeEnv();
      } catch (e) {
        if (!(e instanceof ConfigError)) throw e;
        configured = false;
      }
    }
    if (!configured) return finish(respond(degrade("config")));
    if (mock) {
      stage = "reply";
      const mocked = replyDone(spec.mock(r), "mock");
      return finish(respond(mocked ?? degrade("ai_invalid")));
    }
    if (provider === undefined) return finish(respond(degrade("config")));

    // 9. caches. A hit is answered here: no limit is spent and no model is called.
    stage = "cache";
    let model: string;
    try {
      model = provider.model(spec.tier);
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      return finish(respond(degrade("config")));
    }
    const memory = await memoryRead;
    ev.memoryItems = memory.length;
    const shared = sharedCacheKey(spec.name, r, memory.length, spec.promptVersion, model);
    const own = user !== null && shared === null ? replyKey(user.userHash, spec.name, { r, memory }, spec.promptVersion, model) : null;
    const hitKey = shared ?? own;
    if (hitKey !== null) {
      const hit = (shared !== null ? sharedCache : replyCache).get(hitKey);
      const answer = hit === undefined ? undefined : replyDone(hit, "ok");
      if (answer !== undefined) {
        cacheStatus = "hit";
        return finish(respond(answer));
      }
      cacheStatus = "miss";
    }

    // 10. one computation for identical requests in flight at the same time (and for the same x-idempotency-key)
    const idem = req.headers.get("x-idempotency-key");
    const flightKey = cacheKey([user === null ? `ip:${ipHash}` : user.userHash, spec.name, requestDigest({ r, memory }), spec.promptVersion, model, idem !== null && IDEMPOTENCY_RE.test(idem) ? idem : ""]);
    let led = false;

    const work = async (): Promise<Done> => {
      led = true;
      // 11. daily usage limit
      stage = "limits";
      const limit = await (deps.checkAndBump ?? checkAndBump)({ userHash: user === null ? null : user.userHash, isAnonymous: user === null ? true : user.isAnonymous, ipHash, task: spec.name });
      if (!limit.ok) throw new HttpError(429, "rate_limited", limit.retryAfterSec);

      // 12. evidence, prompt
      stage = "ledger";
      const ledger = spec.buildLedger(redacted);
      ev.thin = spec.name === "plan" && ledger.thin;
      stage = "prompt";
      const companionName = companionOf(redacted);
      const canary = getEvalCanary();
      // spec.build goes through composePrompt, which already holds the preamble and the STYLE, FACTS and TASK regions:
      // they are used as returned. Only the evaluation canary is added.
      const built = spec.build({ r: redacted, ledger, fence: (label, text) => fence(nonce, label, text), memory, companionName });
      const system = canary === undefined ? built.system : `${built.system}\n${canaryLine(canary)}`;
      const userPrompt = built.user;
      const jsonSchema = schemaOf(spec);

      // 13. the model: one retry after a hard failure, one tier swap after a provider error, three calls at most
      let tier = spec.tier;
      // A tier that answered 429 recently is not called again until its Retry-After has passed: start on the other one.
      if (tierCooling(provider, tier, now())) tier = otherTier(tier);
      let retried = false;
      let swapped = false;
      let lastFailure: EventErrorCode = "ai_invalid";
      for (;;) {
        stage = "provider";
        const call = await callProvider(run, provider, { tier, system, user: userPrompt, temperature: spec.temperature, maxOutputTokens: spec.maxOutputTokens, jsonSchema });
        if (!call.ok) {
          lastFailure = call.kind === "config" ? "config" : call.kind === "timeout" ? "timeout" : "ai_unavailable";
          // A 4xx other than 429 is a problem with our request: the other tier would answer the same, so it is not tried.
          // The exception is "this model does not exist or is gone" (404 or a model_not_found code): the other tier may still work.
          const modelGone = call.kind === "rejected" && (call.status === 404 || call.code !== undefined);
          if (swapped || call.kind === "skipped" || call.kind === "config" || call.kind === "aborted" || (call.kind === "rejected" && !modelGone)) break;
          swapped = true;
          tier = otherTier(tier);
          const left = DEADLINE_MS - (now() - run.startedAt);
          const pause = Math.max(0, Math.min(SWAP_PAUSE_MIN_MS + Math.random() * SWAP_PAUSE_SPREAD_MS, left - 2 * RESERVE_MS));
          if (pause > 0) await sleep(pause);
          continue;
        }
        stage = "output";
        const checked = checkOutput(spec, redacted, ledger, call.result.text, canary);
        if (checked.kind === "crisis") return { kind: "crisis", source: "model_flag" };
        ev.guardHits.push(...checked.codes);
        if (checked.reply !== undefined) {
          if (hitKey !== null) (shared !== null ? sharedCache : replyCache).set(hitKey, checked.reply);
          return { kind: "reply", reply: checked.reply, outcome: "ok" };
        }
        lastFailure = "ai_invalid";
        // An answer cut off at the token cap would be cut off again: no identical retry. Swap tier once, else the fallback.
        if (looksCut(call.result.text, call.result.finishReason)) {
          if (swapped) break;
          swapped = true;
          tier = otherTier(tier);
          const left = DEADLINE_MS - (now() - run.startedAt);
          const pause = Math.max(0, Math.min(SWAP_PAUSE_MIN_MS + Math.random() * SWAP_PAUSE_SPREAD_MS, left - 2 * RESERVE_MS));
          if (pause > 0) await sleep(pause);
          continue;
        }
        if (retried) break;
        retried = true;
      }
      stage = "reply";
      return degrade(lastFailure);
    };

    const done = await singleFlight(flightKey, work);
    if (!led) cacheStatus = done.kind === "reply" || done.kind === "degraded" ? "hit" : "bypass";
    return finish(respond(done));
  } catch (e) {
    ev.stage = stage;
    if (e instanceof HttpError || e instanceof AppError) return finish(failure(e));
    // Not one of ours: a bug or a broken dependency. The user still gets the deterministic answer when there is one.
    log.error("ai_request_crashed", e, { stage });
    if (clean !== undefined) {
      try {
        return finish(respond(degrade("ai_invalid")));
      } catch {
        // Even the fallback failed. The fixed 503 below is the answer; the cause was logged above.
      }
    }
    return finish(failure(new HttpError(503, "ai_unavailable")));
  }
}
