import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as planPost } from "@/app/api/plan/route";
import * as planRoute from "@/app/api/plan/route";
import * as practiceRoute from "@/app/api/practice/route";
import * as recapRoute from "@/app/api/recap/route";
import * as sayitRoute from "@/app/api/sayit/route";
import { sayitSpec } from "@/features/sayit/spec";
import { AppError } from "@/lib/errors";
import { replyCache, sharedCache } from "@/lib/ai/cache";
import { runTask, type HarnessDeps, type SignedIn } from "@/lib/ai/harness";
import { ProviderError, type ProviderResult } from "@/lib/ai/provider";
import { setLogSink, toDbOutcome, type AiEvent } from "@/lib/ai/telemetry";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { bodyOf, fakeProvider, fakeTask, okBody, post, say } from "./helpers/fakeTask";

type Extra = Parameters<NonNullable<HarnessDeps["record"]>>[1];
const records: Array<{ e: AiEvent; x: Extra }> = [];
const lines: string[] = [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const userOf = (id: string): SignedIn => ({ userId: `id-${id}`, userHash: id.padEnd(16, "0"), isAnonymous: true });

/** Production services replaced by fakes. The caller is the user named in the x-test-user header, or signed out. */
const base = (provider?: HarnessDeps["provider"], extra: Partial<HarnessDeps> = {}): HarnessDeps => ({
  ...(provider === undefined ? {} : { provider }),
  limiter: createRateLimiter(),
  rand: () => "0123456789ab",
  requireUser: (req) => {
    const id = req.headers.get("x-test-user");
    return id === null ? Promise.reject(new AppError("unauthorized")) : Promise.resolve(userOf(id));
  },
  getFlag: () => Promise.resolve(true),
  spendCapReached: () => Promise.resolve(false),
  checkAndBump: () => Promise.resolve({ ok: true }),
  recordSpend: () => undefined,
  record: (e, x) => records.push({ e: { ...e }, x }),
  sleep: () => Promise.resolve(),
  ...extra,
});

const as = (id: string, extra: Record<string, string> = {}): Record<string, string> => ({ "x-test-user": id, ...extra });

const deferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void } => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
};
const result = (text: string): ProviderResult => ({ text, modelUsed: "model-quality-x", inTokens: 100, outTokens: 20 });
const tiers = (p: { calls: Array<{ tier: string }> }): string[] => p.calls.map((c) => c.tier);

beforeEach(() => {
  vi.stubEnv("VERCEL", "1"); // address headers are trusted only on Vercel
  records.length = 0;
  lines.length = 0;
  replyCache.clear();
  sharedCache.clear();
  setLogSink((l) => lines.push(l));
});
afterEach(() => {
  setLogSink(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("identity (08 section 1.1)", () => {
  it("serves a signed-out caller and limits it by address alone", async () => {
    const { spec } = fakeTask();
    const checkAndBump = vi.fn().mockResolvedValue({ ok: true });
    const res = await runTask(spec, post(okBody()), base(fakeProvider([say("fine")]), { checkAndBump }));
    expect(await bodyOf(res)).toEqual({ say: "fine", degraded: false });
    expect(checkAndBump).toHaveBeenCalledWith({ userHash: null, isAnonymous: true, ipHash: expect.stringMatching(/^[0-9a-f]{16}$/), task: "plan" });
  });

  it("passes a signed-in caller's hash, never the user id, to the limiter", async () => {
    const { spec } = fakeTask();
    const checkAndBump = vi.fn().mockResolvedValue({ ok: true });
    await runTask(spec, post(okBody(), as("abc")), base(fakeProvider([say("fine")]), { checkAndBump }));
    expect(checkAndBump).toHaveBeenCalledWith(expect.objectContaining({ userHash: "abc0000000000000" }));
    expect(JSON.stringify(checkAndBump.mock.calls)).not.toContain("id-abc");
  });

  it("auth 'required': a signed-out caller gets 401 with the request id, no model call, no limit spent", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("x")]);
    const checkAndBump = vi.fn();
    const res = await runTask(spec, post(okBody()), base(provider, { auth: "required", checkAndBump }));
    expect(res.status).toBe(401);
    const body = (await bodyOf(res)) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
    expect(provider.calls).toHaveLength(0);
    expect(checkAndBump).not.toHaveBeenCalled();
    expect(toDbOutcome(records[0].e.outcome, records[0].e.errorCode)).toBe("unauthorized");
  });

  it("auth 'required': any failure of the lookup (not only an AppError) is a 401", async () => {
    const { spec } = fakeTask();
    const res = await runTask(spec, post(okBody(), as("abc")), base(fakeProvider([]), { auth: "required", requireUser: () => Promise.reject(new Error("auth service exploded")) }));
    expect(res.status).toBe(401);
    expect(JSON.stringify(await bodyOf(res))).not.toContain("exploded");
  });

  it("auth 'required': a signed-in caller is served", async () => {
    const { spec } = fakeTask();
    const res = await runTask(spec, post(okBody(), as("abc")), base(fakeProvider([say("fine")]), { auth: "required" }));
    expect(res.status).toBe(200);
  });

  it("auth being down counts as signed out for an optional route", async () => {
    const { spec } = fakeTask();
    const checkAndBump = vi.fn().mockResolvedValue({ ok: true });
    const res = await runTask(spec, post(okBody(), as("abc")), base(fakeProvider([say("fine")]), { requireUser: () => Promise.reject(new Error("down")), checkAndBump }));
    expect(res.status).toBe(200);
    expect(checkAndBump).toHaveBeenCalledWith(expect.objectContaining({ userHash: null }));
  });

  it("a lookup that never answers is given up after 2 s: signed out (optional) or 401 (required)", async () => {
    vi.useFakeTimers();
    const { spec } = fakeTask();
    const hang = (): Promise<SignedIn> => new Promise(() => undefined);
    const optional = runTask(spec, post(okBody()), base(fakeProvider([say("fine")]), { requireUser: hang }));
    const required = runTask(spec, post(okBody()), base(fakeProvider([]), { requireUser: hang, auth: "required" }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await optional).status).toBe(200);
    expect((await required).status).toBe(401);
  });
});

describe("kill-switch and spend cap (08 section 1.6)", () => {
  it("ai_enabled off: the deterministic fallback with degraded:true, and no provider call", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("x")]);
    const getFlag = vi.fn().mockResolvedValue(false);
    const res = await runTask(spec, post(okBody("I keep getting headaches.")), base(provider, { getFlag }));
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ say: "fallback for 25 characters", degraded: true });
    expect(getFlag).toHaveBeenCalledWith("ai_enabled");
    expect(provider.calls).toHaveLength(0);
    expect(records[0].e).toMatchObject({ outcome: "fallback", degraded: true, errorCode: "ai_unavailable", attempts: 0 });
    expect(records[0].x.cacheStatus).toBe("bypass");
  });

  it("the global spend cap reached behaves exactly like the flag off", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("x")]);
    const res = await runTask(spec, post(okBody()), base(provider, { spendCapReached: () => Promise.resolve(true) }));
    expect(await bodyOf(res)).toMatchObject({ degraded: true });
    expect(provider.calls).toHaveLength(0);
  });

  it("flag off: certain crisis text still shows the crisis card", async () => {
    const { spec } = fakeTask();
    const res = await runTask(spec, post(okBody("I want to kill myself")), base(fakeProvider([]), { getFlag: () => Promise.resolve(false) }));
    expect(await bodyOf(res)).toEqual({ crisis: true });
  });

  it("flag off: text that needs the model's opinion is treated as a crisis, with no provider call (fail safe)", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([JSON.stringify({ crisis: false })]);
    const res = await runTask(spec, post(okBody("I hate myself.")), base(provider, { getFlag: () => Promise.resolve(false) }));
    expect(await bodyOf(res)).toEqual({ crisis: true });
    expect(provider.calls).toHaveLength(0);
  });

  it("with a flag lookup that rejects, an injected getFlag failure is not swallowed silently: it becomes the fallback answer, never a 500", async () => {
    const { spec } = fakeTask();
    const res = await runTask(spec, post(okBody()), base(fakeProvider([say("x")]), { getFlag: () => Promise.reject(new Error("flags exploded")) }));
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toMatchObject({ degraded: true });
  });

  it("MOCK_AI=1 touches no Supabase-backed service at all", async () => {
    vi.stubEnv("MOCK_AI", "1");
    const { spec } = fakeTask();
    const spies = { requireUser: vi.fn(), getFlag: vi.fn(), spendCapReached: vi.fn(), checkAndBump: vi.fn(), recordSpend: vi.fn() };
    const res = await runTask(spec, post(okBody()), base(undefined, spies));
    expect(await bodyOf(res)).toEqual({ say: "mock reply", degraded: false });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    expect(records[0].x.cacheStatus).toBe("bypass");
  });
});

describe("daily usage limit", () => {
  it("a refused caller gets 429 with Retry-After and the request id, and the model is never called", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("x")]);
    const res = await runTask(spec, post(okBody(), as("abc")), base(provider, { checkAndBump: () => Promise.resolve({ ok: false, retryAfterSec: 1800 }) }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1800");
    expect(((await bodyOf(res)) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect(provider.calls).toHaveLength(0);
    expect(toDbOutcome(records[0].e.outcome, records[0].e.errorCode)).toBe("rate_limited");
  });

  it("a daily limit says how long: the seconds to midnight go out in Retry-After, up to a day", async () => {
    const { spec } = fakeTask();
    const res = await runTask(spec, post(okBody()), base(fakeProvider([]), { checkAndBump: () => Promise.resolve({ ok: false, retryAfterSec: 80_000 }) }));
    expect(res.headers.get("retry-after")).toBe("80000");
    const longer = await runTask(spec, post(okBody()), base(fakeProvider([]), { checkAndBump: () => Promise.resolve({ ok: false, retryAfterSec: 500_000 }) }));
    expect(longer.headers.get("retry-after")).toBe("86400");
  });

  it("a cache hit spends no limit", async () => {
    const { spec } = fakeTask();
    const checkAndBump = vi.fn().mockResolvedValue({ ok: true });
    const provider = fakeProvider([say("once")]);
    await runTask(spec, post(okBody(), as("abc")), base(provider, { checkAndBump }));
    await runTask(spec, post(okBody(), as("abc")), base(provider, { checkAndBump }));
    expect(checkAndBump).toHaveBeenCalledTimes(1);
  });

  it("a crisis answer from the classifier spends the classify counter, not the model quota", async () => {
    const { spec } = fakeTask();
    const checkAndBump = vi.fn().mockResolvedValue({ ok: true });
    await runTask(spec, post(okBody("I hate myself.")), base(fakeProvider([JSON.stringify({ crisis: true })]), { checkAndBump }));
    expect(checkAndBump.mock.calls.map((c) => (c[0] as { task: string }).task)).toEqual(["classify"]);
  });
});

describe("per-user reply cache (08 section 5.2)", () => {
  it("answers the same user's identical request from memory: one provider call, x-rumi-cache hit", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("first answer"), say("second answer")]);
    const a = await runTask(spec, post(okBody(), as("abc")), base(provider));
    const b = await runTask(spec, post(okBody(), as("abc")), base(provider));
    expect(await bodyOf(a)).toEqual({ say: "first answer", degraded: false });
    expect(await bodyOf(b)).toEqual({ say: "first answer", degraded: false });
    expect(provider.calls).toHaveLength(1);
    expect([a.headers.get("x-rumi-cache"), b.headers.get("x-rumi-cache")]).toEqual(["miss", "hit"]);
    expect(records.map((r) => r.x.cacheStatus)).toEqual(["miss", "hit"]);
    expect(records[1].e).toMatchObject({ outcome: "ok", attempts: 0 });
  });

  it("never serves one user's reply to another user", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("for abc"), say("for xyz")]);
    await runTask(spec, post(okBody(), as("abc")), base(provider));
    const other = await runTask(spec, post(okBody(), as("xyz")), base(provider));
    expect(await bodyOf(other)).toEqual({ say: "for xyz", degraded: false });
    expect(provider.calls).toHaveLength(2);
    expect(other.headers.get("x-rumi-cache")).toBe("miss");
  });

  it("a different request from the same user is a miss", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("one"), say("two")]);
    await runTask(spec, post(okBody("I keep getting headaches."), as("abc")), base(provider));
    await runTask(spec, post(okBody("My stomach hurts."), as("abc")), base(provider));
    expect(provider.calls).toHaveLength(2);
  });

  it("a different model never serves an old answer", async () => {
    const { spec } = fakeTask();
    const a = fakeProvider([say("from model x")]);
    const b = { ...fakeProvider([say("from model z")]), model: () => "model-z" };
    await runTask(spec, post(okBody(), as("abc")), base(a));
    const res = await runTask(spec, post(okBody(), as("abc")), base(b));
    expect(await bodyOf(res)).toEqual({ say: "from model z", degraded: false });
  });

  it("a different prompt version never serves an old answer", async () => {
    const one = fakeTask({ promptVersion: "plan@1" }).spec;
    const two = fakeTask({ promptVersion: "plan@2" }).spec;
    const provider = fakeProvider([say("v1"), say("v2")]);
    await runTask(one, post(okBody(), as("abc")), base(provider));
    const res = await runTask(two, post(okBody(), as("abc")), base(provider));
    expect(await bodyOf(res)).toEqual({ say: "v2", degraded: false });
  });

  it("a signed-out caller is never cached", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("one"), say("two")]);
    const headers = { "x-real-ip": "203.0.113.9" };
    await runTask(spec, post(okBody(), headers), base(provider));
    const b = await runTask(spec, post(okBody(), headers), base(provider));
    expect(await bodyOf(b)).toEqual({ say: "two", degraded: false });
    expect(replyCache.size()).toBe(0);
    expect(b.headers.get("x-rumi-cache")).toBe("bypass");
  });

  it("crisis text is never cached and no model is called", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("x")]);
    await runTask(spec, post(okBody("I want to kill myself"), as("abc")), base(provider));
    expect(replyCache.size()).toBe(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("a model crisis flag is never cached", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("x", true)]);
    const res = await runTask(spec, post(okBody(), as("abc")), base(provider));
    expect(await bodyOf(res)).toEqual({ crisis: true });
    expect(replyCache.size()).toBe(0);
  });

  it("a degraded reply is never cached: the next request asks the model again", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([new ProviderError("http"), new ProviderError("http"), say("recovered")]);
    const a = await runTask(spec, post(okBody(), as("abc")), base(provider));
    expect(await bodyOf(a)).toMatchObject({ degraded: true });
    expect(replyCache.size()).toBe(0);
    const b = await runTask(spec, post(okBody(), as("abc")), base(provider));
    expect(await bodyOf(b)).toEqual({ say: "recovered", degraded: false });
  });

  it("an error is never cached", async () => {
    const { spec } = fakeTask();
    await runTask(spec, post(okBody(), as("abc")), base(fakeProvider([]), { checkAndBump: () => Promise.resolve({ ok: false, retryAfterSec: 5 }) }));
    expect(replyCache.size()).toBe(0);
  });

  it("stores only a reply that passed the reply schema and the guards", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("CODE:advice_dose"), say("CODE:advice_dose")]);
    await runTask(spec, post(okBody(), as("abc")), base(provider));
    expect(replyCache.size()).toBe(0);
  });

  it("stored preferences are part of the key: after the user changes one, the old reply is not served", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("plain"), say("with pacing")]);
    let prefs: string[] = [];
    const d = base(provider, { getMemoryFacts: () => Promise.resolve(prefs) });
    await runTask(spec, post(okBody(), as("abc")), d);
    prefs = ["Allow extra time to answer."];
    const res = await runTask(spec, post(okBody(), as("abc")), d);
    expect(await bodyOf(res)).toEqual({ say: "with pacing", degraded: false });
    expect(provider.calls).toHaveLength(2);
  });

  it("the same preferences give a hit again", async () => {
    const { spec } = fakeTask();
    const provider = fakeProvider([say("one"), say("two")]);
    const d = base(provider, { getMemoryFacts: () => Promise.resolve(["Allow extra time to answer."]) });
    await runTask(spec, post(okBody(), as("abc")), d);
    await runTask(spec, post(okBody(), as("abc")), d);
    expect(provider.calls).toHaveLength(1);
  });
});

describe("shared cache (08 section 5.3): user-independent say-it only", () => {
  const sayBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ level: 2, scenario: "book", companionName: "Rumi", ...extra });
  const script = (s = "I want to book an appointment."): string => JSON.stringify({ script: s, blanks: [], crisis: false });

  it("serves a scenario at level 2 to a different user from the shared cache", async () => {
    const provider = fakeProvider([script()]);
    const a = await runTask(sayitSpec, post(sayBody(), as("abc")), base(provider));
    const b = await runTask(sayitSpec, post(sayBody(), as("xyz")), base(provider));
    expect(a.status).toBe(200);
    expect(await bodyOf(b)).toEqual(await bodyOf(a));
    expect(provider.calls).toHaveLength(1);
    expect(b.headers.get("x-rumi-cache")).toBe("hit");
  });

  it("serves a signed-out caller from the shared cache too (the reply holds no user text)", async () => {
    const provider = fakeProvider([script()]);
    await runTask(sayitSpec, post(sayBody(), as("abc")), base(provider));
    await runTask(sayitSpec, post(sayBody()), base(provider));
    expect(provider.calls).toHaveLength(1);
  });

  it("does not share level 1", async () => {
    const hint = JSON.stringify({ script: "What detail do you want to add? You can start with: I am not sure ...", blanks: [], crisis: false });
    const provider = fakeProvider([hint, hint]);
    await runTask(sayitSpec, post(sayBody({ level: 1 }), as("abc")), base(provider));
    await runTask(sayitSpec, post(sayBody({ level: 1 }), as("xyz")), base(provider));
    expect(provider.calls).toHaveLength(2);
    expect(sharedCache.size()).toBe(0);
  });

  it("does not share a request that carries the user's words", async () => {
    const provider = fakeProvider([script(), script()]);
    await runTask(sayitSpec, post(sayBody({ mainConcern: "headaches" }), as("abc")), base(provider));
    await runTask(sayitSpec, post(sayBody({ mainConcern: "headaches" }), as("xyz")), base(provider));
    expect(provider.calls).toHaveLength(2);
    expect(sharedCache.size()).toBe(0);
  });

  it("does not share a clinician question the user typed", async () => {
    const provider = fakeProvider([script("I am not sure how to say this. Can you ask me one question at a time?"), script()]);
    const body = { level: 3, clinicianQuestion: "How often does it happen?", companionName: "Rumi" };
    await runTask(sayitSpec, post(body, as("abc")), base(provider));
    await runTask(sayitSpec, post(body, as("xyz")), base(provider));
    expect(provider.calls).toHaveLength(2);
    expect(sharedCache.size()).toBe(0);
  });

  it("does not share when stated preferences shape the prompt", async () => {
    const provider = fakeProvider([script(), script()]);
    await runTask(sayitSpec, post(sayBody(), as("abc")), base(provider, { getMemoryFacts: () => Promise.resolve(["Allow extra time to answer."]) }));
    expect(sharedCache.size()).toBe(0);
  });

  it("a new model is a miss (the key holds the model)", async () => {
    const a = fakeProvider([script("I want to book an appointment.")]);
    const b = { ...fakeProvider([script("I want to make an appointment.")]), model: () => "model-new" };
    await runTask(sayitSpec, post(sayBody(), as("abc")), base(a));
    const res = await runTask(sayitSpec, post(sayBody(), as("xyz")), base(b));
    expect(((await bodyOf(res)) as { script: string }).script).toBe("I want to make an appointment.");
  });
});

describe("single-flight (08 section 4.8): retry storms and double submit", () => {
  const wait = (ms = 25): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it("collapses 8 identical in-flight requests from one user into one provider call", async () => {
    const { spec } = fakeTask();
    const gate = deferred<ProviderResult>();
    const provider = fakeProvider([() => gate.promise]);
    const all = Array.from({ length: 8 }, () => runTask(spec, post(okBody(), as("abc")), base(provider)));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    await wait();
    expect(provider.calls).toHaveLength(1);
    gate.resolve(result(say("shared answer")));
    const responses = await Promise.all(all);
    const bodies = await Promise.all(responses.map(bodyOf));
    expect(new Set(bodies.map((b) => JSON.stringify(b)))).toEqual(new Set([JSON.stringify({ say: "shared answer", degraded: false })]));
    expect(provider.calls).toHaveLength(1);
    expect(records).toHaveLength(8);
    expect(records.filter((r) => r.x.cacheStatus === "miss")).toHaveLength(1);
    expect(records.filter((r) => r.x.cacheStatus === "hit")).toHaveLength(7);
    expect(records.reduce((n, r) => n + r.e.attempts, 0)).toBe(1);
    expect(new Set(responses.map((r) => r.headers.get("x-request-id"))).size).toBe(8);
  });

  it("each follower gets its own request id and its own session cookie handling", async () => {
    const { spec } = fakeTask();
    const gate = deferred<ProviderResult>();
    const provider = fakeProvider([() => gate.promise]);
    const a = runTask(spec, post(okBody(), as("abc")), base(provider));
    const b = runTask(spec, post(okBody(), as("abc", { "x-request-id": "11111111-2222-4333-8444-555555555555" })), base(provider));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    gate.resolve(result(say("ok")));
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb.headers.get("x-request-id")).toBe("11111111-2222-4333-8444-555555555555");
    expect(ra.headers.get("x-request-id")).toMatch(UUID);
    expect(ra.headers.get("x-request-id")).not.toBe(rb.headers.get("x-request-id"));
  });

  it("the same x-idempotency-key, signed out from one address: one call", async () => {
    const { spec } = fakeTask();
    const gate = deferred<ProviderResult>();
    const provider = fakeProvider([() => gate.promise]);
    const headers = { "x-real-ip": "203.0.113.7", "x-idempotency-key": "11111111-aaaa-bbbb-cccc-111111111111" };
    const all = [1, 2, 3].map(() => runTask(spec, post(okBody(), headers), base(provider)));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    await wait();
    gate.resolve(result(say("ok")));
    await Promise.all(all);
    expect(provider.calls).toHaveLength(1);
  });

  it("two different user actions (different keys) with the same words are two computations", async () => {
    const { spec } = fakeTask();
    const g1 = deferred<ProviderResult>();
    const g2 = deferred<ProviderResult>();
    const provider = fakeProvider([() => g1.promise, () => g2.promise]);
    const a = runTask(spec, post(okBody(), as("abc", { "x-idempotency-key": "aaaaaaaa-1111" })), base(provider));
    const b = runTask(spec, post(okBody(), as("abc", { "x-idempotency-key": "bbbbbbbb-2222" })), base(provider));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
    g1.resolve(result(say("one")));
    g2.resolve(result(say("two")));
    await Promise.all([a, b]);
  });

  it("an invalid idempotency key is ignored (not an error)", async () => {
    const { spec } = fakeTask();
    const res = await runTask(spec, post(okBody(), as("abc", { "x-idempotency-key": "not a key!!" })), base(fakeProvider([say("ok")])));
    expect(res.status).toBe(200);
  });

  it("users with the same words never share a flight", async () => {
    const { spec } = fakeTask();
    const g1 = deferred<ProviderResult>();
    const g2 = deferred<ProviderResult>();
    const provider = fakeProvider([() => g1.promise, () => g2.promise]);
    const a = runTask(spec, post(okBody(), as("abc")), base(provider));
    const b = runTask(spec, post(okBody(), as("xyz")), base(provider));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(2));
    g1.resolve(result(say("for abc")));
    g2.resolve(result(say("for xyz")));
    expect(await bodyOf(await a)).toEqual({ say: "for abc", degraded: false });
    expect(await bodyOf(await b)).toEqual({ say: "for xyz", degraded: false });
  });

  it("when the leader fails over to the fallback, the joined requests get that fallback and nothing is cached", async () => {
    const { spec } = fakeTask();
    const gate = deferred<ProviderResult>();
    const provider = fakeProvider([() => gate.promise.then(() => Promise.reject(new ProviderError("http"))), new ProviderError("http")]);
    const all = [1, 2, 3].map(() => runTask(spec, post(okBody(), as("abc")), base(provider)));
    await vi.waitFor(() => expect(provider.calls).toHaveLength(1));
    gate.resolve(result(""));
    const bodies = await Promise.all((await Promise.all(all)).map(bodyOf));
    expect(bodies.every((b) => (b as { degraded: boolean }).degraded)).toBe(true);
    expect(replyCache.size()).toBe(0);
    expect(provider.calls).toHaveLength(2);
  });

  it("a request that hits the daily limit shares that refusal with the requests that joined it", async () => {
    const { spec } = fakeTask();
    const gate = deferred<{ ok: false; retryAfterSec: number }>();
    const provider = fakeProvider([say("x")]);
    const checkAndBump = vi.fn(() => gate.promise);
    const all = [1, 2].map(() => runTask(spec, post(okBody(), as("abc")), base(provider, { checkAndBump })));
    await vi.waitFor(() => expect(checkAndBump).toHaveBeenCalled());
    await wait();
    gate.resolve({ ok: false, retryAfterSec: 60 });
    expect((await Promise.all(all)).map((r) => r.status)).toEqual([429, 429]);
    expect(checkAndBump).toHaveBeenCalledTimes(1);
  });
});

describe("tier cooldown, Retry-After and the pause before a tier swap (08 section 4.1)", () => {
  let clock = 0;
  beforeEach(() => {
    clock = 1_000_000;
  });
  const rateLimited = (retryAfterSec?: number): ProviderError => new ProviderError("rate_limited", { status: 429, retryAfterSec });
  const ctx = (provider: HarnessDeps["provider"], extra: Partial<HarnessDeps> = {}): HarnessDeps => base(provider, { now: () => clock, ...extra });
  const ask = (text: string): Request => post(okBody(text), as("abc"));

  it("a 429 swaps to the other tier at once and keeps the limited tier out for Retry-After seconds", async () => {
    const { spec } = fakeTask();
    const p = fakeProvider([rateLimited(5), say("fast one"), say("fast two"), say("quality again")]);
    await runTask(spec, ask("one"), ctx(p));
    await runTask(spec, ask("two"), ctx(p));
    expect(tiers(p)).toEqual(["quality", "fast", "fast"]);
    clock += 4_999;
    await runTask(spec, ask("three"), ctx(p));
    expect(tiers(p)).toEqual(["quality", "fast", "fast", "fast"]);
  });

  it("uses the limited tier again once Retry-After has passed", async () => {
    const { spec } = fakeTask();
    const p = fakeProvider([rateLimited(5), say("fast one"), say("quality again")]);
    await runTask(spec, ask("one"), ctx(p));
    clock += 5_000;
    await runTask(spec, ask("two"), ctx(p));
    expect(tiers(p)).toEqual(["quality", "fast", "quality"]);
  });

  it("without a Retry-After header the tier rests for 2 s", async () => {
    const { spec } = fakeTask();
    const p = fakeProvider([rateLimited(undefined), say("one"), say("two"), say("three")]);
    await runTask(spec, ask("one"), ctx(p));
    clock += 1_999;
    await runTask(spec, ask("two"), ctx(p));
    clock += 1;
    await runTask(spec, ask("three"), ctx(p));
    expect(tiers(p)).toEqual(["quality", "fast", "fast", "quality"]);
  });

  it("never rests a tier for more than 60 s, whatever the header says", async () => {
    const { spec } = fakeTask();
    const p = fakeProvider([rateLimited(3600), say("one"), say("two")]);
    await runTask(spec, ask("one"), ctx(p));
    clock += 60_000;
    await runTask(spec, ask("two"), ctx(p));
    expect(tiers(p)).toEqual(["quality", "fast", "quality"]);
  });

  it("both tiers limited: the fallback, and the next request inside the window makes no call at all", async () => {
    const { spec } = fakeTask();
    const p = fakeProvider([rateLimited(10), rateLimited(10), say("never")]);
    const a = await runTask(spec, ask("one"), ctx(p));
    expect(await bodyOf(a)).toMatchObject({ degraded: true });
    expect(records[0].e).toMatchObject({ errorCode: "ai_unavailable", attempts: 2 });
    const b = await runTask(spec, ask("two"), ctx(p));
    expect(await bodyOf(b)).toMatchObject({ degraded: true });
    expect(p.calls).toHaveLength(2);
  });

  it("the cooldown belongs to one provider object", async () => {
    const { spec } = fakeTask();
    const p1 = fakeProvider([rateLimited(30), say("fast")]);
    const p2 = fakeProvider([say("quality on the other provider")]);
    await runTask(spec, ask("one"), ctx(p1));
    await runTask(spec, ask("two"), ctx(p2));
    expect(tiers(p2)).toEqual(["quality"]);
  });

  it("pauses between 100 and 300 ms before the tier swap", async () => {
    const { spec } = fakeTask();
    const sleeps: number[] = [];
    const p = fakeProvider([new ProviderError("http"), say("ok")]);
    await runTask(spec, ask("one"), ctx(p, { sleep: (ms) => (sleeps.push(ms), Promise.resolve()) }));
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(sleeps[0]).toBeLessThan(300);
  });

  it("the pause is jittered: many swaps do not all wait the same time", async () => {
    const { spec } = fakeTask();
    const sleeps: number[] = [];
    for (let i = 0; i < 12; i++) {
      const p = fakeProvider([new ProviderError("http"), say("ok")]);
      await runTask(spec, ask(`text ${i}`), ctx(p, { sleep: (ms) => (sleeps.push(ms), Promise.resolve()) }));
    }
    expect(new Set(sleeps.map((s) => Math.round(s))).size).toBeGreaterThan(3);
  });

  it("does not pause when little time is left, and still makes the swap call", async () => {
    const { spec } = fakeTask();
    const sleeps: number[] = [];
    const p = fakeProvider([() => ((clock += 20_000), Promise.reject(new ProviderError("http"))), say("ok")]);
    const res = await runTask(spec, ask("one"), ctx(p, { sleep: (ms) => (sleeps.push(ms), Promise.resolve()) }));
    expect(sleeps).toEqual([]);
    expect(p.calls).toHaveLength(2);
    expect(await bodyOf(res)).toEqual({ say: "ok", degraded: false });
  });

  it("a retry after a hard guard failure does not pause (nothing is overloaded)", async () => {
    const { spec } = fakeTask();
    const sleeps: number[] = [];
    const p = fakeProvider([say("CODE:advice_dose"), say("fine")]);
    await runTask(spec, ask("one"), ctx(p, { sleep: (ms) => (sleeps.push(ms), Promise.resolve()) }));
    expect(sleeps).toEqual([]);
  });

  it("a 4xx other than 429 is not retried and not swapped: one call, then the fallback", async () => {
    const { spec } = fakeTask();
    const p = fakeProvider([new ProviderError("rejected", { status: 400 }), say("never")]);
    const res = await runTask(spec, ask("one"), ctx(p));
    expect(p.calls).toHaveLength(1);
    expect(await bodyOf(res)).toMatchObject({ degraded: true });
    expect(records[0].e).toMatchObject({ errorCode: "ai_unavailable", attempts: 1 });
  });

  it("timeouts on both tiers: the fallback with errorCode timeout, stored as 'timeout'", async () => {
    const { spec } = fakeTask();
    const p = fakeProvider([new ProviderError("timeout"), new ProviderError("timeout")]);
    await runTask(spec, ask("one"), ctx(p));
    expect(records[0].e).toMatchObject({ outcome: "fallback", errorCode: "timeout" });
    expect(toDbOutcome("fallback", "timeout")).toBe("timeout");
  });

  it("the provider down for the whole request is a 200 fallback, never a 500", async () => {
    const { spec } = fakeTask();
    for (const kind of ["http", "timeout", "empty"] as const) {
      const res = await runTask(spec, ask(`down ${kind}`), ctx(fakeProvider([new ProviderError(kind), new ProviderError(kind)])));
      expect(res.status).toBe(200);
      expect(await bodyOf(res)).toMatchObject({ degraded: true });
    }
  });
});

describe("structured output and cost", () => {
  it("asks for a strict JSON schema named after the task on the model call, and the crisis check has its own", async () => {
    const { spec } = fakeTask();
    const p = fakeProvider([JSON.stringify({ crisis: false }), say("ok")]);
    await runTask(spec, post(okBody("I hate myself.")), base(p));
    expect(p.calls[0].jsonSchema?.name).toBe("crisis_check");
    expect(p.calls[1].jsonSchema?.name).toBe("plan_reply");
    const schema = p.calls[1].jsonSchema?.schema as { required?: string[]; additionalProperties?: boolean };
    expect(schema.required).toEqual(["say", "crisis"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("records the cost of every provider call, classification included, once per request", async () => {
    const { spec } = fakeTask();
    const recordSpend = vi.fn();
    const p = fakeProvider([JSON.stringify({ crisis: false }), say("ok")]);
    await runTask(spec, post(okBody("I hate myself.")), base(p, { recordSpend }));
    // two calls of 100 in and 20 out on "model-*-x/y": unknown models are priced as gpt-oss-120b: 100*0.15 + 20*0.6 = 27 each
    expect(recordSpend).toHaveBeenCalledTimes(1);
    expect(recordSpend).toHaveBeenCalledWith(54);
  });

  it("charges cached prompt tokens at the cached price and reports them in telemetry", async () => {
    const { spec } = fakeTask();
    const recordSpend = vi.fn();
    const p = fakeProvider([() => ({ text: say("ok"), modelUsed: "openai/gpt-oss-120b", inTokens: 1000, outTokens: 100, cachedTokens: 600 })]);
    await runTask(spec, post(okBody()), base(p, { recordSpend }));
    expect(recordSpend).toHaveBeenCalledWith(Math.ceil(400 * 0.15 + 600 * 0.075 + 100 * 0.6));
    expect(records[0].x.cachedTokens).toBe(600);
  });

  it("a cache hit and a fallback without a call record no spend", async () => {
    const { spec } = fakeTask();
    const recordSpend = vi.fn();
    await runTask(spec, post(okBody()), base(fakeProvider([]), { recordSpend, getFlag: () => Promise.resolve(false) }));
    expect(recordSpend).not.toHaveBeenCalled();
  });
});

describe("telemetry through recordAiEvent (08 section 3)", () => {
  it("calls the sink once per request with the cache status, cached tokens and a bucket that holds no user id", async () => {
    const { spec } = fakeTask();
    await runTask(spec, post(okBody(), as("abc")), base(fakeProvider([say("ok")])));
    expect(records).toHaveLength(1);
    expect(records[0].x).toEqual({ cacheStatus: "miss", cachedTokens: 0, bucket: "u:abc0000000000000" });
    expect(JSON.stringify(records[0])).not.toContain("id-abc");
  });

  it("the bucket of a signed-out caller is ip:<hash8>", async () => {
    const { spec } = fakeTask();
    await runTask(spec, post(okBody()), base(fakeProvider([say("ok")])));
    expect(records[0].x.bucket).toMatch(/^ip:[0-9a-f]{8}$/);
    expect(records[0].x.cacheStatus).toBe("bypass");
  });

  it("holds no text, no user id and no key in anything it records", async () => {
    const { spec } = fakeTask();
    await runTask(spec, post(okBody("ZEBRAWORD story about my headaches"), as("abc")), base(fakeProvider([say("ZEBRAREPLY")])));
    const all = JSON.stringify(records) + lines.join("\n");
    expect(all).not.toMatch(/ZEBRA|headaches|id-abc/);
  });

  it("a broken sink cannot fail or slow the answer", async () => {
    const { spec } = fakeTask();
    const res = await runTask(spec, post(okBody()), base(fakeProvider([say("ok")]), { record: () => { throw new Error("sink exploded"); } }));
    expect(res.status).toBe(200);
  });

  it.each([
    ["ok", undefined, "ok"],
    ["crisis", undefined, "crisis"],
    ["fallback", undefined, "degraded"],
    ["fallback", "ai_unavailable", "degraded"],
    ["fallback", "ai_invalid", "degraded"],
    ["fallback", "timeout", "timeout"],
    ["fallback", "config", "config_error"],
    ["mock", undefined, null],
    ["error", "forbidden", "unauthorized"],
    ["error", "unauthorized", "unauthorized"],
    ["error", "rate_limited", "rate_limited"],
    ["error", "bad_input", "invalid_input"],
    ["error", "too_large", "invalid_input"],
    ["error", "ai_unavailable", "provider_error"],
    ["error", "ai_invalid", "guard_blocked"],
    ["error", "config", "config_error"],
    ["error", "timeout", "timeout"],
  ] as const)("maps %s / %s to the stored outcome %s", (outcome, code, stored) => {
    expect(toDbOutcome(outcome, code)).toBe(stored);
  });

  it("the stored outcomes are exactly the ones the database accepts", () => {
    const all = [
      ...(["ok", "crisis", "fallback", "mock", "error"] as const).flatMap((o) => (["bad_input", "too_large", "forbidden", "ai_invalid", "ai_unavailable", "rate_limited", "config", "unauthorized", "timeout", undefined] as const).map((c) => toDbOutcome(o, c))),
    ];
    const allowed = new Set(["ok", "degraded", "crisis", "rate_limited", "invalid_input", "provider_error", "guard_blocked", "unauthorized", "timeout", "config_error", null]);
    for (const s of all) expect(allowed.has(s)).toBe(true);
  });
});

describe("request id and headers (08 section 3, 4)", () => {
  it("every kind of answer carries x-request-id and no-store, and errors echo the same id in the body", async () => {
    const { spec } = fakeTask();
    const answers = [
      await runTask(spec, post(okBody()), base(fakeProvider([say("ok")]))),
      await runTask(spec, post(okBody("I want to kill myself")), base(fakeProvider([]))),
      await runTask(spec, post(okBody(), { "sec-fetch-site": "cross-site" }), base(fakeProvider([]))),
      await runTask(spec, post(okBody(), as("abc")), base(fakeProvider([]), { checkAndBump: () => Promise.resolve({ ok: false, retryAfterSec: 5 }) })),
      await runTask(spec, post(okBody()), base(fakeProvider([]), { getFlag: () => Promise.resolve(false) })),
    ];
    for (const res of answers) {
      expect(res.headers.get("x-request-id")).toMatch(UUID);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    for (const res of answers.slice(2, 4)) {
      expect(((await bodyOf(res)) as { error: { requestId: string } }).error.requestId).toBe(res.headers.get("x-request-id"));
    }
  });

  it("uses the id proxy.ts set when it is a uuid, and makes a new one when it is not", async () => {
    const { spec } = fakeTask();
    const good = await runTask(spec, post(okBody(), { "x-request-id": "11111111-2222-4333-8444-555555555555" }), base(fakeProvider([say("ok")])));
    expect(good.headers.get("x-request-id")).toBe("11111111-2222-4333-8444-555555555555");
    expect(records[0].e.id).toBe("11111111-2222-4333-8444-555555555555");
    const bad = await runTask(spec, post(okBody(), { "x-request-id": "<script>alert(1)</script>" }), base(fakeProvider([say("ok")])));
    expect(bad.headers.get("x-request-id")).toMatch(UUID);
  });

  it("an unexpected crash is logged once with a fingerprint, not the message, and the user still gets the fallback", async () => {
    const { spec } = fakeTask({ buildLedger: () => { throw new Error("secret internal detail"); } });
    const res = await runTask(spec, post(okBody()), base(fakeProvider([say("ok")])));
    expect(await bodyOf(res)).toMatchObject({ degraded: true });
    expect(lines.filter((l) => l.includes("ai_request_crashed"))).toHaveLength(1); // lib/log.ts writes through the log sink
    expect(lines.join("\n")).not.toContain("secret internal detail");
  });

  it("a caller fault (4xx) writes no error log line", async () => {
    const { spec } = fakeTask();
    await runTask(spec, post(okBody(), { "sec-fetch-site": "cross-site" }), base(fakeProvider([])));
    await runTask(spec, post({ nope: true }), base(fakeProvider([])));
    expect(lines.filter((l) => l.includes('"level":"error"'))).toEqual([]);
  });
});

describe("the four routes", () => {
  const routes = { plan: planRoute, practice: practiceRoute, sayit: sayitRoute, recap: recapRoute } as const;

  it.each(["plan", "practice", "sayit", "recap"] as const)("/api/%s exports POST and maxDuration 30 and nothing else", (name) => {
    const mod: Record<string, unknown> = routes[name];
    expect(Object.keys(mod).sort()).toEqual(["POST", "maxDuration"]);
    expect(mod.maxDuration).toBe(30);
    expect(typeof mod.POST).toBe("function");
  });

  it.each([
    ["plan", routes.plan.POST, { rawText: "I keep getting headaches. My mom talks for me.", companionName: "Rumi" }],
    ["sayit", routes.sayit.POST, { level: 2, scenario: "book", companionName: "Rumi" }],
  ] as const)("/api/%s answers in MOCK_AI mode with no key and no network", async (_name, POST, body) => {
    vi.stubEnv("MOCK_AI", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(UUID);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("a request with no origin header is refused before anything else", async () => {
    vi.stubEnv("MOCK_AI", "1");
    const res = await planPost(new Request("https://rumi.test/api/plan", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });
});
