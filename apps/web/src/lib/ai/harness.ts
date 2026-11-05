/**
 * runTask: the one request pipeline behind /api/plan, /api/practice, /api/sayit and /api/recap.
 * The order of the stages is a contract (06 section 4, 07 D2 D5 D7 D18 D19 D43), and tests pin it:
 *
 *   guardRequest (origin, session, limits, declared size, key format)
 *   -> readJson with a byte cap -> Zod request schema
 *   -> every string leaf through promptForm into a clone (the parsed body is never changed) -> schema again (I-044)
 *   -> crisis check on spec.crisisFields (tier "certain": card; tier "check": one cheap model call, fail safe)
 *   -> PII redaction and injection count -> configuration check -> MOCK_AI shortcut
 *   -> ledger -> stated memory strings -> prompt (nonce regions, canary) -> provider calls (at most 3, 22 s)
 *   -> output guards (model crisis flag before Zod, Zod, links, advice, task rules) -> finalize -> reply schema
 *   -> on any hard failure or a provider that is down: spec.fallback with degraded:true
 *   -> one telemetry line (codes and counts only) -> JSON answer, no-store, session cookie appended.
 *
 * Nothing the user typed, nothing from memory and no key is ever written to a log line or an error body.
 */
import { z } from "zod";
import { factStrings } from "@/features/memory/factText";
import { COMPANION_RE, LIMITS } from "@/features/shared/constants";
import { isHard, type GuardCode } from "@/features/shared/guards";
import { FactsRequest } from "@/features/shared/schemas";
import type { EvidenceLedger, TaskSpec, Tier } from "@/features/shared/task";
import { crisisTier } from "@/lib/crisis";
import { ConfigError, assertRuntimeEnv, getEvalCanary, isProduction, mockAiEnabled } from "@/lib/env";
import { HttpError, errorResponse, json, readJson } from "./http";
import { adviceCodes, claimsHumanCodes, clinicianFindingCodes, collectStrings, mapStrings, stripUrls } from "./guards/output";
import { MAX_GUARD_CHARS, promptForm, redactPii, scanInjection } from "./guards/input";
import { buildCrisisCheckPrompt, buildPreamble, canaryLine, containsCanary, fence, newNonce, renderFactsRegion, renderStyleRegion, renderTaskRegion } from "./prompt";
import { ProviderError, createGroqProvider, type Provider, type ProviderCall, type ProviderResult } from "./provider";
import { logEvent, type AiEvent, type EventErrorCode, type Stage } from "./telemetry";
import { guardRequest } from "@/lib/security/guardRequest";
import type { RateLimiter } from "@/lib/security/rateLimit";

export interface HarnessDeps {
  /** Tests inject a fake. Without it the Groq provider is used (and not at all in MOCK_AI mode). */
  provider?: Provider;
  limiter?: RateLimiter;
  now?: () => number;
  /** Source of the request id and the prompt nonce (12 hex characters each). */
  rand?: () => string;
}

/** One deadline per request, a cap per call, and a pause so the fallback always has time to answer (07 D18). */
const DEADLINE_MS = 22_000;
const CALL_MAX_MS = 10_000;
const RESERVE_MS = 1_000;
const MAX_CALLS = 3;
const BREAKER_FAILS = 3;
const BREAKER_PAUSE_MS = 30_000;
/** The tier 2 crisis question needs a one-word answer; the cap is for the reasoning tokens of a small model. */
const CLASSIFY_MAX_TOKENS = 400;
const MAX_MODEL_TEXT = 100_000;

/** Keys whose values are ids or enum values (checked by Zod): never redacted, scanned or stripped as free text. */
const ID_KEYS = new Set(["id", "itemId", "planId", "evidence", "coveredItemIds", "createdAt", "companionName", "kind", "source", "role", "focus", "speaker", "mySpeaker", "scenario", "section", "status"]);
const isIdKey = (key: string): boolean => ID_KEYS.has(key);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const otherTier = (t: Tier): Tier => (t === "quality" ? "fast" : "quality");

const ClassifierAnswer = z.object({ crisis: z.boolean() });
const MemoryFacts = FactsRequest.shape.facts;

// ---------------------------------------------------------------- the provider and its circuit breaker

let groq: Provider | undefined;
const defaultProvider = (): Provider => (groq ??= createGroqProvider());

interface Breaker {
  fails: number;
  openUntil: number;
  /** True while the one half-open probe call is in flight. */
  probing: boolean;
  /** Counts failures. A success counts only if no failure happened since its call started. */
  version: number;
}
/** One breaker per provider object, so each serverless instance and each test provider has its own. */
const breakers = new WeakMap<Provider, Breaker>();
function breakerOf(p: Provider): Breaker {
  let b = breakers.get(p);
  if (b === undefined) {
    b = { fails: 0, openUntil: 0, probing: false, version: 0 };
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

const ProviderAnswer = z.object({ text: z.string().min(1), inTokens: z.number(), outTokens: z.number() });

/** Why no provider answer was produced. 'skipped': breaker open, deadline or call budget used up. */
type CallFailure = ProviderError["kind"] | "skipped";
type CallOutcome = { ok: true; result: ProviderResult } | { ok: false; kind: CallFailure };

/** The telemetry event while the request runs: the same fields, but the guard hits can still be added to. */
type LiveEvent = Omit<AiEvent, "guardHits"> & { guardHits: GuardCode[] };

interface Run {
  now: () => number;
  startedAt: number;
  calls: number;
  ev: LiveEvent;
}

/** The only place a provider is called. Enforces the call cap, the deadline, the breaker and the telemetry counts. */
async function callProvider(run: Run, provider: Provider | undefined, call: Omit<ProviderCall, "signal">): Promise<CallOutcome> {
  if (provider === undefined) return { ok: false, kind: "config" };
  const breaker = breakerOf(provider);
  const left = DEADLINE_MS - (run.now() - run.startedAt);
  const budget = Math.min(CALL_MAX_MS, left - RESERVE_MS);
  const tripped = breaker.fails >= BREAKER_FAILS;
  // Open: skip. Half-open (the pause is over): one probe call at a time, every other call is skipped until it ends.
  if (run.calls >= MAX_CALLS || budget <= 0 || (tripped && (breaker.openUntil > run.now() || breaker.probing))) return { ok: false, kind: "skipped" };

  const probe = tripped;
  if (probe) breaker.probing = true;
  const version = breaker.version;
  run.calls += 1;
  run.ev.attempts = run.calls;
  run.ev.tier = call.tier;
  try {
    const answer = await withTimeout(provider, call, budget);
    const valid = ProviderAnswer.safeParse(answer);
    if (!valid.success) throw new ProviderError("empty");
    // A success that started before a newer failure must not close a breaker those failures opened.
    if (breaker.version === version) {
      breaker.fails = 0;
      breaker.openUntil = 0;
    }
    run.ev.inTokens += Math.max(0, Math.floor(answer.inTokens));
    run.ev.outTokens += Math.max(0, Math.floor(answer.outTokens));
    return { ok: true, result: answer };
  } catch (e) {
    // Anything that is not a ProviderError is a bug in a provider; it counts as a failed call like any other.
    const kind = e instanceof ProviderError ? e.kind : "http";
    run.ev.providerKind = kind;
    if (kind !== "config" && kind !== "aborted") {
      breaker.fails += 1;
      breaker.version += 1;
      // The pause is counted from this failure, which is when it is noticed (a call that hangs fails at its timeout).
      if (breaker.fails >= BREAKER_FAILS) breaker.openUntil = run.now() + BREAKER_PAUSE_MS;
    }
    return { ok: false, kind };
  } finally {
    if (probe) breaker.probing = false;
  }
}

// ---------------------------------------------------------------- model text

/** JSON.parse that accepts one ``` fence around the JSON and drops a __proto__ key. undefined when it is not JSON. */
/** The model's own crisis flag in any shape: prose around it, a fence, nested, quoted, any case. Matching the raw text is deliberate. */
const MODEL_CRISIS_FLAG = /["']?crisis["']?\s*[:=]\s*["']?true\b/i;

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
  const call = await callProvider(run, provider, { tier: "fast", ...prompt, temperature: 0, maxOutputTokens: CLASSIFY_MAX_TOKENS });
  if (!call.ok) return true;
  const answer = ClassifierAnswer.safeParse(parseModelJson(call.result.text));
  return !answer.success || answer.data.crisis;
}

type Verdict<Reply> = { kind: "crisis" } | { kind: "checked"; codes: GuardCode[]; reply?: Reply };

const unique = <T>(list: readonly T[]): T[] => [...new Set(list)];

/** Everything between the model's text and a reply the user may see. Returns codes only, never text. */
function checkOutput<Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, r: Req, ledger: EvidenceLedger, text: string, canary: string | undefined): Verdict<Reply> {
  const raw = parseModelJson(text);
  if ((isRecord(raw) && raw.crisis === true) || MODEL_CRISIS_FLAG.test(text.slice(0, MAX_MODEL_TEXT))) return { kind: "crisis" }; // D5: read before Zod, so a reply of only {"crisis":true} counts
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

/** Stated preferences from the body's `facts` (never help_level, 07 D25). Anything invalid is ignored: it never fails the request. */
function memoryStrings(useMemory: boolean, body: unknown): string[] {
  if (!useMemory || !isRecord(body)) return [];
  const facts = MemoryFacts.safeParse(body.facts);
  return facts.success ? factStrings(facts.data.filter((f) => f.kind !== "help_level")) : [];
}

/** Words that would read as an instruction when placed in "You are <name>". Whole words only. */
const NAME_BLOCKED = new Set(["never", "ignore", "refuse", "always", "must", "system", "instructions", "prompt", "pretend", "jailbreak"]);
const SAFE_NAME = /^[A-Za-z]{2,15}(?: [A-Za-z]{2,15})?$/;

/** The helper name goes into the system prompt, so it is held to a stricter rule than the schema: otherwise "Rumi". */
function companionOf(r: unknown): string {
  const name = isRecord(r) ? r.companionName : undefined;
  if (typeof name !== "string" || !COMPANION_RE.test(name) || !SAFE_NAME.test(name)) return "Rumi";
  if (name.toLowerCase().split(" ").some((w) => NAME_BLOCKED.has(w)) || scanInjection(name) > 0) return "Rumi";
  return name;
}

const withDegraded = (reply: unknown, degraded: boolean): unknown => ({ ...(reply as object), degraded });

export async function runTask<Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, req: Request, deps: HarnessDeps = {}): Promise<Response> {
  const now = deps.now ?? Date.now;
  const rand = deps.rand ?? newNonce;
  const run: Run = {
    now,
    startedAt: now(),
    calls: 0,
    ev: {
      id: rand(),
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
  /** The sanitized request, once it exists. The fallback and the mock use it (not the redacted copy). */
  let clean: Req | undefined;

  const finish = (res: Response): Response => {
    ev.ms = Math.max(0, now() - run.startedAt);
    logEvent(ev);
    if (cookie !== null) res.headers.append("Set-Cookie", cookie);
    return res;
  };
  const crisis = (): Response => {
    ev.outcome = "crisis";
    return json({ crisis: true });
  };
  const answer = (reply: unknown, outcome: "ok" | "mock"): Response | undefined => {
    const parsed = spec.reply.safeParse(withDegraded(reply, false));
    if (!parsed.success) return undefined;
    ev.outcome = outcome;
    return json(parsed.data);
  };
  /** The deterministic AI-down answer. Throws HttpError(503) if even this cannot be built. */
  const degrade = (code: EventErrorCode): Response => {
    ev.outcome = "fallback";
    ev.degraded = true;
    ev.errorCode = code;
    const parsed = spec.reply.safeParse(withDegraded(spec.fallback(clean as Req), true));
    if (!parsed.success) throw new HttpError(503, "ai_unavailable");
    return json(parsed.data);
  };

  try {
    // 1. same origin, session, limits, declared size, key format
    const guard = guardRequest(req, { limiter: deps.limiter, maxBytes: LIMITS.bodyBytesMax });
    cookie = guard.session.setCookie;

    // 2. body with a byte cap, then the request schema
    stage = "body";
    const body = await readJson(req, LIMITS.bodyBytesMax);
    stage = "request";
    const parsed = spec.request.safeParse(body);
    if (!parsed.success) throw new HttpError(400, "bad_input");

    // 3. every string leaf cleaned into a clone; the schema runs again so text that is empty after cleaning is refused (I-044)
    stage = "sanitize";
    const sanitized = spec.request.safeParse(
      mapStrings(parsed.data, (s) => {
        // Nothing the guards cannot scan is let through: an oversize field is refused before any pattern runs on it.
        if (s.length > MAX_GUARD_CHARS) throw new HttpError(413, "too_large");
        return promptForm(s);
      }),
    );
    if (!sanitized.success) throw new HttpError(400, "bad_input");
    const r = sanitized.data;
    clean = r;

    // 4. crisis: deterministic, before any model sees anything
    stage = "crisis";
    const flagged: string[] = [];
    for (const text of Object.values(spec.crisisFields(r))) {
      const tier = crisisTier(text);
      if (tier === "certain") return finish(crisis());
      if (tier === "check") flagged.push(text);
    }
    const nonce = rand();
    const provider = deps.provider ?? (mockAiEnabled() ? undefined : defaultProvider());
    if (flagged.length > 0) {
      stage = "provider";
      // Text that tries to steer the classifier is not trusted to it: the card is shown.
      if (flagged.some((t) => scanInjection(t) > 0)) return finish(crisis());
      // Numbers and contacts are redacted but names are not ("I am Hopeless" must stay readable to the classifier).
      const text = redactPii(flagged.map((t) => t.slice(0, LIMITS.rawTextMax)).join("\n"), { names: false }).text;
      if (await modelSaysCrisis(run, provider, nonce, text)) return finish(crisis());
    }

    // 5. personal details out, injection counted (never blocked)
    stage = "redact";
    const redacted = mapStrings(
      r,
      (s) => {
        ev.injectionHits += scanInjection(s);
        const red = redactPii(s); // each field is at most MAX_GUARD_CHARS here (checked when the request was cleaned)
        ev.redactions += red.count;
        return red.text;
      },
      isIdKey,
    );

    // 6. configuration, then the mock shortcut
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
    if (!configured) return finish(degrade("config"));
    if (mockAiEnabled()) {
      stage = "reply";
      if (isProduction()) ev.stage = "mock_prod"; // MOCK_AI must never be set in production; this makes it visible
      const mocked = answer(spec.mock(r), "mock");
      return finish(mocked ?? degrade("ai_invalid"));
    }

    // 7. evidence, stated preferences, prompt
    stage = "ledger";
    const ledger = spec.buildLedger(redacted);
    ev.thin = spec.name === "plan" && ledger.thin;
    const memory = memoryStrings(spec.useMemory, body);
    ev.memoryItems = memory.length;
    stage = "prompt";
    const companionName = companionOf(redacted);
    const canary = getEvalCanary();
    const built = spec.build({ r: redacted, ledger, fence: (label, text) => fence(nonce, label, text), memory, companionName });
    const system = [buildPreamble(companionName), built.system, ...(canary === undefined ? [] : [canaryLine(canary)])].join("\n");
    const user = [renderStyleRegion(memory, nonce), renderFactsRegion(ledger, nonce, (label, text) => fence(nonce, label, text)), renderTaskRegion(built.user, nonce)].join("\n");

    // 8. the model: one retry after a hard failure, one tier swap after a provider error, three calls at most
    stage = "provider";
    let tier = spec.tier;
    let retried = false;
    let swapped = false;
    let failure: EventErrorCode = "ai_invalid";
    for (;;) {
      stage = "provider";
      const call = await callProvider(run, provider, { tier, system, user, temperature: spec.temperature, maxOutputTokens: spec.maxOutputTokens });
      if (!call.ok) {
        failure = call.kind === "config" ? "config" : "ai_unavailable";
        if (swapped || call.kind === "skipped" || call.kind === "config" || call.kind === "aborted") break;
        swapped = true;
        tier = otherTier(tier);
        continue;
      }
      stage = "output";
      const verdict = checkOutput(spec, redacted, ledger, call.result.text, canary);
      if (verdict.kind === "crisis") return finish(crisis());
      ev.guardHits.push(...verdict.codes);
      if (verdict.reply !== undefined) {
        ev.outcome = "ok";
        return finish(json(verdict.reply));
      }
      failure = "ai_invalid";
      if (retried) break;
      retried = true;
    }
    stage = "reply";
    return finish(degrade(failure));
  } catch (e) {
    ev.stage = stage;
    if (e instanceof HttpError) {
      ev.outcome = "error";
      ev.degraded = false;
      ev.errorCode = e.code;
      return finish(errorResponse(e));
    }
    if (clean !== undefined) {
      try {
        return finish(degrade("ai_invalid"));
      } catch {
        // Even the fallback failed. The fixed 503 below is the answer; nothing from the cause is kept.
      }
    }
    ev.outcome = "error";
    ev.degraded = false;
    ev.errorCode = "ai_unavailable";
    return finish(errorResponse(new HttpError(503, "ai_unavailable")));
  }
}
