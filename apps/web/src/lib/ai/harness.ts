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
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { AppError, toResponse } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/requestContext";
import { recordAiEvent } from "@/lib/telemetry/sinks";
import { getMemoryFacts } from "@/features/memory/supabaseStore";
import { COMPANION_RE, LIMITS } from "@/features/shared/constants";
import { isHard, type GuardCode } from "@/features/shared/guards";
import type { EvidenceLedger, TaskSpec, Tier } from "@/features/shared/task";
import { crisisTier } from "@/lib/crisis";
import { ConfigError, assertRuntimeEnv, getEvalCanary, mockAiEnabled } from "@/lib/env";
import { HttpError, json, readJson, retryAfter } from "./http";
import { replyCache, replyKey, requestDigest, cacheKey, sharedCache, sharedCacheKey, singleFlight } from "./cache";
import { getFlag } from "./flags";
import { bucketOf, checkAndBump, costMicroUsd, recordSpend, spendCapReached } from "./limits";
import { adviceCodes, claimsHumanCodes, clinicianFindingCodes, collectStrings, mapStrings, stripUrls } from "./guards/output";
import { promptForm, redactPii, scanInjection } from "./guards/input";
import { buildCrisisCheckPrompt, buildPreamble, canaryLine, containsCanary, fence, newNonce, renderFactsRegion, renderStyleRegion, renderTaskRegion } from "./prompt";
import { ProviderError, createGroqProvider, toStrictJsonSchema, type JsonSchemaSpec, type Provider, type ProviderCall, type ProviderResult } from "./provider";
import type { AiEvent, EventErrorCode, Stage } from "./telemetry";
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
  recordSpend?: (costMicroUsd: number) => void;
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
  /** Per tier: do not call this tier before this time (a 429 and its Retry-After). */
  cooldownUntil: Record<Tier, number>;
}
/** One breaker per provider object, so each serverless instance and each test provider has its own. */
const breakers = new WeakMap<Provider, Breaker>();
function breakerOf(p: Provider): Breaker {
  let b = breakers.get(p);
  if (b === undefined) {
    b = { fails: 0, openUntil: 0, cooldownUntil: { quality: 0, fast: 0 } };
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

const ProviderAnswer = z.object({ text: z.string().min(1), inTokens: z.number(), outTokens: z.number(), cachedTokens: z.number().optional(), modelUsed: z.string().optional() });

/** Why no provider answer was produced. 'skipped': breaker open, tier cooling down, deadline or call budget used up. */
type CallFailure = ProviderError["kind"] | "skipped";
type CallOutcome = { ok: true; result: ProviderResult } | { ok: false; kind: CallFailure };

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
}

const tierCooling = (p: Provider, tier: Tier, now: number): boolean => breakerOf(p).cooldownUntil[tier] > now;

/** The only place a provider is called. Enforces the call cap, the deadline, the breaker, tier cooldowns and the counts. */
async function callProvider(run: Run, provider: Provider | undefined, call: Omit<ProviderCall, "signal">): Promise<CallOutcome> {
  if (provider === undefined) return { ok: false, kind: "config" };
  const breaker = breakerOf(provider);
  const left = DEADLINE_MS - (run.now() - run.startedAt);
  const budget = Math.min(CALL_MAX_MS, left - RESERVE_MS);
  if (run.calls >= MAX_CALLS || breaker.openUntil > run.now() || tierCooling(provider, call.tier, run.now()) || budget <= 0) return { ok: false, kind: "skipped" };

  run.calls += 1;
  run.ev.attempts = run.calls;
  run.ev.tier = call.tier;
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
    run.cachedTokens += cached;
    run.costMicro += costMicroUsd(answer.modelUsed ?? "", inTokens, cached, outTokens);
    return { ok: true, result: answer };
  } catch (e) {
    // Anything that is not a ProviderError is a bug in a provider; it counts as a failed call like any other.
    const kind = e instanceof ProviderError ? e.kind : "http";
    if (kind !== "config" && kind !== "aborted") {
      breaker.fails += 1;
      if (breaker.fails >= BREAKER_FAILS) breaker.openUntil = run.now() + BREAKER_PAUSE_MS;
    }
    if (kind === "rate_limited") {
      const wait = e instanceof ProviderError && e.retryAfterSec !== undefined ? e.retryAfterSec * 1000 : COOLDOWN_DEFAULT_MS;
      breaker.cooldownUntil[call.tier] = run.now() + Math.min(wait, COOLDOWN_MAX_MS);
    }
    return { ok: false, kind };
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

/** Tier 2 (07 D43): true means show the crisis card. A failed call, an unreadable answer or a wrong shape all mean yes. */
async function modelSaysCrisis(run: Run, provider: Provider | undefined, nonce: string, text: string): Promise<boolean> {
  const prompt = buildCrisisCheckPrompt(nonce, text);
  const call = await callProvider(run, provider, { tier: "fast", ...prompt, temperature: 0, maxOutputTokens: CLASSIFY_MAX_TOKENS, jsonSchema: CLASSIFIER_SCHEMA });
  if (!call.ok) return true;
  const answer = ClassifierAnswer.safeParse(parseModelJson(call.result.text));
  return !answer.success || answer.data.crisis;
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
 * gives up after 1.5 s and returns []). Facts a browser sends in the body are never used. A signed-out caller has none.
 */
async function memoryStrings(useMemory: boolean, userId: string | null, read: (userId: string) => Promise<string[]>): Promise<string[]> {
  if (!useMemory || userId === null) return [];
  try {
    const facts = await read(userId);
    return Array.isArray(facts) ? facts.filter((f): f is string => typeof f === "string" && f.trim() !== "").slice(0, LIMITS.factsMax) : [];
  } catch {
    // The contract says this never throws; if a broken store does, the request goes on without preferences (they only adapt wording).
    return [];
  }
}

function companionOf(r: unknown): string {
  const name = isRecord(r) ? r.companionName : undefined;
  return typeof name === "string" && COMPANION_RE.test(name) ? name : "Rumi";
}

const withDegraded = (reply: unknown, degraded: boolean): unknown => ({ ...(reply as object), degraded });

/** What the work of one request produced. Shared by every request that joined the same computation. */
type Done = { kind: "crisis" } | { kind: "reply"; reply: unknown; outcome: "ok" | "mock" } | { kind: "degraded"; reply: unknown; code: EventErrorCode };

type CacheStatus = "miss" | "hit" | "bypass";

export async function runTask<Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, req: Request, deps: HarnessDeps = {}): Promise<Response> {
  const now = deps.now ?? Date.now;
  const rand = deps.rand ?? newNonce;
  const sleep = deps.sleep ?? defaultSleep;
  const headerId = req.headers.get(REQUEST_ID_HEADER);
  const requestId = headerId !== null && REQUEST_ID_RE.test(headerId) ? headerId : newRequestId();
  const log = createLogger({ requestId, route: `/api/${spec.name}` });
  const run: Run = {
    now,
    startedAt: now(),
    calls: 0,
    costMicro: 0,
    cachedTokens: 0,
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
  /** The sanitized request, once it exists. The fallback and the mock use it (not the redacted copy). */
  let clean: Req | undefined;

  const finish = (res: Response): Response => {
    ev.ms = Math.max(0, now() - run.startedAt);
    res.headers.set(REQUEST_ID_HEADER, requestId);
    res.headers.set("x-rumi-cache", cacheStatus);
    if (cookie !== null) res.headers.append("Set-Cookie", cookie);
    try {
      (deps.record ?? recordAiEvent)(ev, { cacheStatus, cachedTokens: run.cachedTokens, bucket: bucketOf(user === null ? null : user.userHash, ipHash) });
    } catch {
      // Telemetry never blocks or fails an answer. recordAiEvent swallows its own failures; this is for a broken injected sink.
    }
    if (run.costMicro > 0) {
      try {
        (deps.recordSpend ?? recordSpend)(run.costMicro);
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
    stage = "crisis";
    const flagged: string[] = [];
    for (const text of Object.values(spec.crisisFields(r))) {
      const tier = crisisTier(text);
      if (tier === "certain") return finish(respond({ kind: "crisis" }));
      if (tier === "check") flagged.push(text);
    }

    // 6. kill-switch and spend cap. Either one means no provider call at all; a text that needs the model's opinion
    //    about crisis is then treated as a crisis (fail safe, same as a provider that is down).
    let aiOff = false;
    if (!mock) {
      stage = "flags";
      aiOff = !(await (deps.getFlag ?? getFlag)("ai_enabled")) || (await (deps.spendCapReached ?? spendCapReached)());
    }
    const nonce = rand();
    const provider = deps.provider ?? (mock ? undefined : defaultProvider());
    if (flagged.length > 0) {
      stage = "provider";
      const text = redactPii(flagged.join("\n")).text.slice(0, LIMITS.rawTextMax);
      if (aiOff || (await modelSaysCrisis(run, provider, nonce, text))) return finish(respond({ kind: "crisis" }));
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
    const memory = await memoryStrings(spec.useMemory, user === null ? null : user.userId, deps.getMemoryFacts ?? getMemoryFacts);
    ev.memoryItems = memory.length;
    const shared = sharedCacheKey(spec.name, r, memory.length, spec.promptVersion, model);
    const own = user !== null && shared === null ? replyKey(user.userHash, spec.name, { body, memory }, spec.promptVersion, model) : null;
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
    const flightKey = cacheKey([user === null ? `ip:${ipHash}` : user.userHash, spec.name, requestDigest({ body, memory }), spec.promptVersion, model, idem !== null && IDEMPOTENCY_RE.test(idem) ? idem : ""]);
    let led = false;

    const work = async (): Promise<Done> => {
      led = true;
      // 11. daily usage limit
      stage = "limits";
      const limit = await (deps.checkAndBump ?? checkAndBump)({ userHash: user === null ? null : user.userHash, ipHash, task: spec.name });
      if (!limit.ok) throw new HttpError(429, "rate_limited", limit.retryAfterSec);

      // 12. evidence, prompt
      stage = "ledger";
      const ledger = spec.buildLedger(redacted);
      ev.thin = spec.name === "plan" && ledger.thin;
      stage = "prompt";
      const companionName = companionOf(redacted);
      const canary = getEvalCanary();
      const built = spec.build({ r: redacted, ledger, fence: (label, text) => fence(nonce, label, text), memory, companionName });
      const system = [buildPreamble(companionName), built.system, ...(canary === undefined ? [] : [canaryLine(canary)])].join("\n");
      const userPrompt = [renderStyleRegion(memory, nonce), renderFactsRegion(ledger, nonce, (label, text) => fence(nonce, label, text)), renderTaskRegion(built.user, nonce)].join("\n");
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
          // A 4xx other than 429 is a request problem: the other tier would answer the same, so it is not tried.
          if (swapped || call.kind === "skipped" || call.kind === "config" || call.kind === "aborted" || call.kind === "rejected") break;
          swapped = true;
          tier = otherTier(tier);
          const left = DEADLINE_MS - (now() - run.startedAt);
          const pause = Math.max(0, Math.min(SWAP_PAUSE_MIN_MS + Math.random() * SWAP_PAUSE_SPREAD_MS, left - 2 * RESERVE_MS));
          if (pause > 0) await sleep(pause);
          continue;
        }
        stage = "output";
        const checked = checkOutput(spec, redacted, ledger, call.result.text, canary);
        if (checked.kind === "crisis") return { kind: "crisis" };
        ev.guardHits.push(...checked.codes);
        if (checked.reply !== undefined) {
          if (hitKey !== null) (shared !== null ? sharedCache : replyCache).set(hitKey, checked.reply);
          return { kind: "reply", reply: checked.reply, outcome: "ok" };
        }
        lastFailure = "ai_invalid";
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
