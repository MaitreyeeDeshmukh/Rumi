/**
 * Chaos: the AI provider misbehaves. Rule 4 of the addendum: never return a default on error; return the fallback WITH
 * degraded:true, or an error. The user-visible promise is: a failing provider never produces a 5xx and never changes what
 * we log. The provider is the real Groq adapter talking to a scripted `fetch`, so HTTP-level faults are what the app sees.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeWhen } from "./lanes";
import { loadLane, type HarnessModule, type ProviderModule } from "./frozen";
import { captureLogs, chaosSpec, expectNoLeak, groq, post, scriptedFetch, stubLiveEnv, type FetchStep, type Logs } from "./fakes";

// Waiting for lane ai-runtime: src/lib/ai/harness.ts and provider.ts (branches agent/p2-harness, agent/p2-routes, extended by prod-ai-runtime).
describeWhen("ai-runtime", ["lib/ai/harness", "lib/ai/provider"], "chaos: the provider fails", () => {
  let logs: Logs;
  beforeEach(() => {
    logs = captureLogs();
    stubLiveEnv();
  });
  afterEach(() => {
    logs.stop();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /** One request through runTask with a fresh provider (and so a fresh circuit breaker) unless one is passed. */
  async function ask(fetchFn: typeof fetch, run: () => Promise<unknown> = async () => undefined) {
    const { runTask } = await loadLane<HarnessModule>("lib/ai/harness");
    const { createGroqProvider } = await loadLane<ProviderModule>("lib/ai/provider");
    const provider = createGroqProvider({ fetchFn });
    const pending = runTask(chaosSpec(), post(), { provider });
    await run();
    const res = await pending;
    return { res, body: await res.text(), provider };
  }

  function expectFallback(res: Response, body: string): void {
    expect(res.status, "a provider fault must not become an error status").toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(JSON.parse(body)).toEqual({ say: "Here is a plain answer you can edit.", degraded: true });
    expectNoLeak(logs, body);
  }

  const faults: [string, () => FetchStep][] = [
    ["429 rate limited with Retry-After", () => groq.status(429, { "retry-after": "3" })],
    ["500", () => groq.status(500)],
    ["503", () => groq.status(503)],
    ["network failure", () => groq.network()],
    ["200 with text that is not JSON", () => groq.badJson()],
    ["200 with an empty message (refusal)", () => groq.refusal()],
  ];

  it.each(faults)("provider down for the whole request (%s): fallback with degraded:true, never a 5xx", async (_name, fault) => {
    const fetchFn = scriptedFetch(fault());
    const { res, body } = await ask(fetchFn);
    expectFallback(res, body);
    expect(fetchFn.calls, "at most three provider calls per request").toBeLessThanOrEqual(3);
  });

  it("a stalled provider (timeout) ends in the fallback before the request deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fetchFn = scriptedFetch(groq.hang());
    const { res, body } = await ask(fetchFn, () => vi.advanceTimersByTimeAsync(30_000));
    expectFallback(res, body);
  });

  it("one failure then success recovers without telling the user (retry on 5xx and 429, tier swap)", async () => {
    for (const first of [groq.status(500), groq.status(429, { "retry-after": "1" }), groq.network()]) {
      const fetchFn = scriptedFetch(first, groq.ok("Recovered answer."));
      const { res, body } = await ask(fetchFn);
      expect(res.status).toBe(200);
      expect(JSON.parse(body)).toMatchObject({ say: "Recovered answer." });
      expect(JSON.parse(body).degraded).not.toBe(true);
      expect(fetchFn.calls).toBe(2);
      expectNoLeak(logs, body);
    }
  });

  it("a retry storm during an outage does not hammer the provider: the circuit opens and later requests make no call", async () => {
    const { runTask } = await loadLane<HarnessModule>("lib/ai/harness");
    const { createGroqProvider } = await loadLane<ProviderModule>("lib/ai/provider");
    const fetchFn = scriptedFetch(groq.status(500));
    const provider = createGroqProvider({ fetchFn });
    const bodies: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await runTask(chaosSpec(), post(), { provider, now: () => 1_000_000 });
      expect(res.status).toBe(200);
      bodies.push(await res.text());
      expect(JSON.parse(bodies[i])).toMatchObject({ degraded: true });
    }
    expect(fetchFn.calls, "25 requests during an outage").toBeLessThanOrEqual(6);
    expectNoLeak(logs, bodies.join("\n"));
  });

  it("an unexpected throw inside the provider adapter still ends in a fallback and leaks nothing", async () => {
    const { runTask } = await loadLane<HarnessModule>("lib/ai/harness");
    const provider = {
      async complete(): Promise<never> {
        throw new Error("BOOM-internal-detail-8f3a ZEBRA-MARIGOLD");
      },
    };
    const res = await runTask(chaosSpec(), post(), { provider });
    const body = await res.text();
    expectFallback(res, body);
  });
});
