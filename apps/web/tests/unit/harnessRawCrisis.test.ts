import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runTask, type HarnessDeps } from "@/lib/ai/harness";
import { setLogSink } from "@/lib/ai/telemetry";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { bodyOf, fakeProvider, fakeTask, okBody, post, providerError, say, type FakeSpec } from "./helpers/fakeTask";

const logs: string[] = [];
const event = (): Record<string, unknown> => JSON.parse(logs[0]) as Record<string, unknown>;
const deps = (provider?: HarnessDeps["provider"], extra: Partial<HarnessDeps> = {}): HarnessDeps => ({
  ...(provider === undefined ? {} : { provider }),
  limiter: createRateLimiter(),
  rand: () => "0123456789ab",
  ...extra,
});
const CRISIS = "I want to kill myself.";
const BAD = { error: { code: "bad_input", message: "I could not read that. Check what you wrote and try again." } };

beforeEach(() => {
  logs.length = 0;
  setLogSink((l) => logs.push(l));
});
afterEach(() => setLogSink(null));

describe("P2-1: a crisis phrase in a request that is refused before the crisis check still gets the card", () => {
  it("a 2500-character message that starts with a certain phrase (over the field limit, so 400) shows the card", async () => {
    const provider = fakeProvider([say("never")]);
    const res = await runTask(fakeTask().spec, post(okBody(`${CRISIS} ${"x".repeat(2500)}`)), deps(provider));
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ crisis: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(provider.calls).toHaveLength(0);
    expect(event()).toMatchObject({ outcome: "crisis", attempts: 0 });
    expect(event().errorCode).toBeUndefined();
  });

  it("the same with an invalid companionName", async () => {
    const res = await runTask(fakeTask().spec, post(okBody(`${CRISIS} ${"x".repeat(2500)}`, { companionName: "Rumi<script>" })), deps(fakeProvider([])));
    expect(await bodyOf(res)).toEqual({ crisis: true });
  });

  it("a short message with an invalid companionName shows the card too", async () => {
    const res = await runTask(fakeTask().spec, post(okBody(CRISIS, { companionName: "Rumi<script>" })), deps(fakeProvider([])));
    expect(await bodyOf(res)).toEqual({ crisis: true });
  });

  it("a leaf over 10,000 characters (the 413 path) with the phrase in its first 4000 characters shows the card", async () => {
    const big = fakeTask({ request: z.object({ text: z.string().min(1).max(50_000), companionName: z.string() }) as unknown as FakeSpec["request"] });
    const res = await runTask(big.spec, post(okBody(`${CRISIS} ${"x".repeat(10_500)}`)), deps(fakeProvider([])));
    expect(await bodyOf(res)).toEqual({ crisis: true });
    expect(event()).toMatchObject({ outcome: "crisis" });
  });

  it("finds the phrase in an unexpected field, in a nested object and in an array", async () => {
    for (const body of [
      { text: 5, companionName: "Rumi", note: CRISIS },
      { text: 5, nested: { a: { b: [{ c: CRISIS }] } } },
      ["x", [CRISIS]],
    ]) {
      expect(await bodyOf(await runTask(fakeTask().spec, post(body), deps(fakeProvider([]))))).toEqual({ crisis: true });
    }
  });

  it("only a certain phrase counts: tier check text and ordinary text keep the plain refusal", async () => {
    const tooLong = "x".repeat(2500);
    expect(await bodyOf(await runTask(fakeTask().spec, post(okBody(`I hate myself. ${tooLong}`)), deps(fakeProvider([]))))).toEqual(BAD);
    expect(await bodyOf(await runTask(fakeTask().spec, post(okBody(`I keep getting headaches. ${tooLong}`)), deps(fakeProvider([]))))).toEqual(BAD);
  });

  it("scans the first 4000 characters of a leaf and no more", async () => {
    const res = await runTask(fakeTask().spec, post(okBody(`${"x ".repeat(2100)}${CRISIS}`)), deps(fakeProvider([])));
    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual(BAD);
  });

  it("is depth limited and never throws on odd shapes: scalars, null, very deep nesting, thousands of leaves", async () => {
    let deep: unknown = CRISIS;
    for (let i = 0; i < 40; i++) deep = { a: deep };
    const many = JSON.stringify({ many: Array.from({ length: 5000 }, (_, i) => `leaf ${i}`), late: CRISIS }); // the phrase is the 5001st string
    for (const raw of ["null", "5", '"just a string"', "true", "[]", "{}", JSON.stringify(deep), many]) {
      const started = Date.now();
      const res = await runTask(fakeTask().spec, post(null, {}, raw), deps(fakeProvider([])));
      expect(res.status).toBe(400);
      expect(await bodyOf(res)).toEqual(BAD);
      expect(Date.now() - started).toBeLessThan(3000);
    }
    let shallow: unknown = CRISIS;
    for (let i = 0; i < 4; i++) shallow = { a: shallow };
    expect(await bodyOf(await runTask(fakeTask().spec, post(shallow), deps(fakeProvider([]))))).toEqual({ crisis: true });
  });

  it("a plain string body that is a certain phrase gets the card (a leaf at the top)", async () => {
    expect(await bodyOf(await runTask(fakeTask().spec, post(null, {}, JSON.stringify(CRISIS)), deps(fakeProvider([]))))).toEqual({ crisis: true });
  });

  it("an unreadable body (not JSON, invalid) has no leaves: still 400", async () => {
    const res = await runTask(fakeTask().spec, post(null, {}, `{"text":"${CRISIS}`), deps(fakeProvider([])));
    expect(res.status).toBe(400);
  });

  it("only a refusal at the request or cleaning stage is rescanned: a 503 from a broken fallback is not turned into a card by text in a field that is not a crisis field", async () => {
    const broken = fakeTask({ fallback: () => ({ say: 5 }) as never });
    const res = await runTask(broken.spec, post(okBody("Headaches.", { other: CRISIS })), deps(fakeProvider([providerError("http"), providerError("http")])));
    expect(res.status).toBe(503);
  });

  it("known limit: a request refused by the rate limit (429) is refused before the body is read, so there is no card", async () => {
    const limiter = createRateLimiter({ limits: { perIp: 1 } });
    const same = { "x-real-ip": "203.0.113.77" };
    await runTask(fakeTask().spec, post(okBody(), same), deps(fakeProvider([say("ok")]), { limiter }));
    const res = await runTask(fakeTask().spec, post(okBody(CRISIS), same), deps(fakeProvider([]), { limiter }));
    expect(res.status).toBe(429);
  });
});
