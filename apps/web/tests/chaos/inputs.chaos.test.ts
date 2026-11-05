/**
 * Chaos: hostile or broken callers. Oversize and malformed bodies, floods, cross-site posts, and a telemetry writer handed
 * user text. These controls exist on this branch already, so this file runs now; the end-to-end block runs when runTask lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/features/shared/constants";
import { HttpError, errorResponse, readJson } from "@/lib/ai/http";
import { logEvent } from "@/lib/ai/telemetry";
import { guardRequest } from "@/lib/security/guardRequest";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { describeWhen } from "./lanes";
import { loadLane, type HarnessModule } from "./frozen";
import { captureLogs, chaosSpec, expectNoLeak, post, stubLiveEnv, USER_TEXT, type Logs } from "./fakes";

const CAP = LIMITS.bodyBytesMax;

/** The status and error code of the HttpError a call throws, or null when it does not throw one. */
async function failure(fn: () => unknown): Promise<{ status: number; code: string; retryAfterSec?: number } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, code: e.code, retryAfterSec: e.retryAfterSec };
    throw e;
  }
}

describe("chaos: oversize and malformed bodies", () => {
  it("a declared Content-Length over the cap is refused as 413 before any byte is read", async () => {
    const req = post({}, { "content-length": String(CAP + 1) });
    expect(await failure(() => readJson(req, CAP))).toEqual({ status: 413, code: "too_large", retryAfterSec: undefined });
  });

  it("a body with no length header is cut off at the cap: the stream is cancelled, not buffered", async () => {
    let pulled = 0;
    let cancelled = false;
    const chunk = new Uint8Array(8_192).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += chunk.byteLength;
        c.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = post(undefined, {}, stream);
    expect(await failure(() => readJson(req, CAP))).toMatchObject({ status: 413, code: "too_large" });
    expect(cancelled).toBe(true);
    expect(pulled, "bytes pulled from an endless stream").toBeLessThan(CAP * 2);
  });

  it("a lying Content-Length (small header, big body) is still caught by the byte count", async () => {
    const big = JSON.stringify({ text: "x".repeat(CAP) });
    expect(await failure(() => readJson(post(undefined, { "content-length": "10" }, big), CAP))).toMatchObject({ status: 413 });
  });

  it.each([
    ["not JSON", "{nope"],
    ["invalid UTF-8", new Uint8Array([0xff, 0xfe, 0x7b])],
    ["empty body", ""],
  ])("%s is a 400 bad_input whose answer never repeats the input", async (_n, raw) => {
    const f = await failure(() => readJson(post(undefined, {}, raw), CAP));
    expect(f).toMatchObject({ status: 400, code: "bad_input" });
    const answer = errorResponse(new HttpError(400, "bad_input"));
    expect(answer.headers.get("cache-control")).toBe("no-store");
    expect(await answer.text()).not.toContain("nope");
  });

  it("a __proto__ key from the wire cannot reach the parsed object", async () => {
    const parsed = (await readJson(post(undefined, {}, '{"__proto__":{"admin":true},"a":1}'), CAP)) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(parsed.a).toBe(1);
    expect(Object.keys(parsed)).toEqual(["a"]);
  });
});

describe("chaos: floods and cross-site posts", () => {
  it("the request after the limit is a 429 with a positive Retry-After, never a 500", async () => {
    const limiter = createRateLimiter({ limits: { perIp: 5, perSession: 100, perInstance: 1000 } });
    const same = { "x-real-ip": "203.0.113.200" };
    for (let i = 0; i < 5; i += 1) guardRequest(post({}, same), { limiter });
    const f = await failure(() => guardRequest(post({}, same), { limiter }));
    expect(f).toMatchObject({ status: 429, code: "rate_limited" });
    const res = errorResponse(new HttpError(429, "rate_limited", f?.retryAfterSec));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a flood of one-off addresses cannot grow the limiter without bound (memory stays capped)", () => {
    const limiter = createRateLimiter({ limits: { maxKeys: 100, perIp: 50, perInstance: 1_000_000 } });
    for (let i = 0; i < 2_000; i += 1) limiter.check(`ip-${i}`, `session-${i}`);
    expect(limiter.tracked().ips).toBeLessThanOrEqual(100);
    expect(limiter.tracked().sessions).toBeLessThanOrEqual(100);
  });

  it("a refused request does not extend its own lockout (retry storms cannot lock themselves out forever)", () => {
    let t = 0;
    const limiter = createRateLimiter({ now: () => t, limits: { perIp: 2, windowMs: 60_000 } });
    limiter.check("a", null);
    limiter.check("a", null);
    for (let i = 0; i < 100; i += 1) {
      t += 100;
      expect(limiter.check("a", null).ok).toBe(false);
    }
    t = 60_001;
    expect(limiter.check("a", null).ok, "the window is over once 60 s pass, however many refused tries came in between").toBe(true);
  });

  it.each([
    ["another site", { "sec-fetch-site": "cross-site" }],
    ["an origin from another host", { "sec-fetch-site": "same-origin", origin: "https://evil.test" }],
    ["an Origin of null", { "sec-fetch-site": "same-origin", origin: "null" }],
  ])("a post from %s is a 403", async (_n, headers) => {
    expect(await failure(() => guardRequest(post({}, headers), { limiter: createRateLimiter() }))).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("chaos: the telemetry writer is handed user text and a key", () => {
  let logs: Logs;
  beforeEach(() => void (logs = captureLogs()));
  afterEach(() => logs.stop());

  it("fields that are not on the allowlist or not in the right shape never reach the log line", () => {
    const base = { id: "0b9e2f5c-1111-4222-8333-444455556666", task: "plan", promptVersion: "plan@1", outcome: "ok", degraded: false, attempts: 1, tier: "quality", redactions: 0, injectionHits: 0, thin: false, guardHits: [], memoryItems: 0, inTokens: 1, outTokens: 1, ms: 5 };
    logEvent({ ...base, text: USER_TEXT, key: "gsk_CHAOSKEY0123456789abcdefghij", message: USER_TEXT } as never);
    logEvent({ ...base, id: USER_TEXT, promptVersion: USER_TEXT, errorCode: USER_TEXT, task: USER_TEXT, outcome: USER_TEXT, tier: USER_TEXT, guardHits: [USER_TEXT] } as never);
    expect(logs.lines).toHaveLength(2);
    expectNoLeak(logs);
  });

  it("a null or garbage event does not throw (telemetry can never break a request)", () => {
    expect(() => logEvent(null as never)).not.toThrow();
    expect(() => logEvent("ZEBRA-MARIGOLD" as never)).not.toThrow();
    expectNoLeak(logs);
  });
});

// Waiting for lane ai-runtime: src/lib/ai/harness.ts (branch agent/p2-harness, extended by prod-ai-runtime).
describeWhen("ai-runtime", ["lib/ai/harness"], "chaos: oversize and malformed bodies through runTask", () => {
  let logs: Logs;
  beforeEach(() => {
    logs = captureLogs();
    stubLiveEnv();
  });
  afterEach(() => {
    logs.stop();
    vi.unstubAllEnvs();
  });

  it.each([
    ["declared too large", 413, () => post({}, { "content-length": String(CAP + 1) })],
    ["undeclared too large", 413, () => post(undefined, {}, JSON.stringify({ text: "x".repeat(CAP + 10), companionName: "Rumi" }))],
    ["not JSON", 400, () => post(undefined, {}, `{${USER_TEXT}`)],
    ["wrong shape", 400, () => post({ text: 5, companionName: "Rumi" })],
  ])("%s: exactly that 4xx, no provider call, nothing leaked", async (_n, status, make) => {
    const { runTask } = await loadLane<HarnessModule>("lib/ai/harness");
    const calls: number[] = [];
    const provider = {
      async complete(): Promise<never> {
        calls.push(1);
        throw new Error("must not be called");
      },
    };
    const res = await runTask(chaosSpec(), make(), { provider });
    const body = await res.text();
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(calls).toHaveLength(0);
    expectNoLeak(logs, body);
  });
});
