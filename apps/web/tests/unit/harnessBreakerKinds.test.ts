import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTask, type HarnessDeps } from "@/lib/ai/harness";
import { setLogSink } from "@/lib/ai/telemetry";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { bodyOf, fakeProvider, fakeTask, okBody, post, providerError, say, type Scripted } from "./helpers/fakeTask";

const HEX = "0123456789ab";
const deps = (provider: HarnessDeps["provider"], now = 7_000_000): HarnessDeps => ({ provider, limiter: createRateLimiter(), rand: () => HEX, now: () => now });
const LONG = "I keep getting headaches."; // 25 characters: also goes to the crisis classifier
const empty = (): Scripted => (() => ({ text: "", modelUsed: "m", inTokens: 1, outTokens: 1 })) as Scripted;

beforeEach(() => setLogSink(() => undefined));
afterEach(() => setLogSink(null));

describe("circuit breaker (P2-6): only http and timeout failures count", () => {
  it.each([
    ["empty", providerError("empty"), 6],
    ["a 2xx answer with no text", empty(), 6],
    ["aborted", providerError("aborted"), 3], // an abort is not retried on the other tier
  ] as Array<[string, Scripted, number]>)("%s answers in three requests do not open the breaker: the fourth request still reaches the provider", async (_n, bad, perThree) => {
    const p = fakeProvider([...Array<Scripted>(perThree).fill(bad), say("served")]);
    const d = deps(p);
    for (let i = 0; i < 3; i++) expect(await bodyOf(await runTask(fakeTask().spec, post(okBody()), d))).toMatchObject({ degraded: true });
    expect(p.calls).toHaveLength(perThree);
    expect(await bodyOf(await runTask(fakeTask().spec, post(okBody()), d))).toEqual({ say: "served", degraded: false });
    expect(p.calls).toHaveLength(perThree + 1);
  });

  it("three empty answers in one request (task call, swap, then nothing) do not open the breaker", async () => {
    const p = fakeProvider([providerError("empty"), providerError("empty"), say("served")]);
    const d = deps(p);
    await runTask(fakeTask().spec, post(okBody()), d); // two empties: both tiers
    await runTask(fakeTask().spec, post(okBody()), d); // the third empty (the first call) then a good swap answer
    expect(p.calls).toHaveLength(3);
    const third = await runTask(fakeTask().spec, post(okBody()), d);
    expect(p.calls.length).toBeGreaterThan(3); // a breaker that had opened would have skipped every call
    expect(await bodyOf(third)).toBeDefined();
  });

  it("three http failures still open it (the kind that counts)", async () => {
    const p = fakeProvider([providerError("http"), providerError("http"), providerError("http"), say("never")]);
    const d = deps(p);
    await runTask(fakeTask().spec, post(okBody()), d);
    await runTask(fakeTask().spec, post(okBody()), d);
    expect(p.calls).toHaveLength(3);
    await runTask(fakeTask().spec, post(okBody()), d);
    expect(p.calls).toHaveLength(3);
  });

  it("timeouts count too", async () => {
    const p = fakeProvider([providerError("timeout"), providerError("timeout"), providerError("timeout"), say("never")]);
    const d = deps(p);
    await runTask(fakeTask().spec, post(okBody()), d);
    await runTask(fakeTask().spec, post(okBody()), d);
    await runTask(fakeTask().spec, post(okBody()), d);
    expect(p.calls).toHaveLength(3);
  });

  it("the crisis classifier call is counted the same way: classifier, task and swap all empty leave it closed; all http open it", async () => {
    const empties = fakeProvider([providerError("empty"), providerError("empty"), providerError("empty"), say("served")]);
    await runTask(fakeTask().spec, post(okBody(LONG)), deps(empties));
    expect(empties.calls).toHaveLength(3);
    await runTask(fakeTask().spec, post(okBody()), deps(empties));
    expect(empties.calls).toHaveLength(4); // the breaker is closed: the call was made

    const https = fakeProvider([providerError("http"), providerError("http"), providerError("http"), say("never")]);
    await runTask(fakeTask().spec, post(okBody(LONG)), deps(https));
    expect(https.calls).toHaveLength(3);
    await runTask(fakeTask().spec, post(okBody()), deps(https));
    expect(https.calls).toHaveLength(3); // open: skipped
  });
});
