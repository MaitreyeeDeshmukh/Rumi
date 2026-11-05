import { describe, expect, it } from "vitest";
import { cacheKey, createTtlCache, replyKey, requestDigest, sharedCacheKey, singleFlight } from "@/lib/ai/cache";

const deferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const REPLY_MAX = 500;

describe("singleFlight", () => {
  it("runs the work once for N identical callers in flight, and all of them get the result", async () => {
    const d = deferred<string>();
    let runs = 0;
    const work = (): Promise<string> => {
      runs += 1;
      return d.promise;
    };
    const callers = Array.from({ length: 10 }, () => singleFlight("same", work));
    d.resolve("answer");
    expect(await Promise.all(callers)).toEqual(Array(10).fill("answer"));
    expect(runs).toBe(1);
  });

  it("different keys run separately", async () => {
    let runs = 0;
    await Promise.all(["a", "b", "c"].map((k) => singleFlight(k, async () => ++runs)));
    expect(runs).toBe(3);
  });

  it("forgets the key when the work ends, so the next request runs again", async () => {
    let runs = 0;
    await singleFlight("again", async () => ++runs);
    await singleFlight("again", async () => ++runs);
    expect(runs).toBe(2);
  });

  it("shares a failure with the callers that joined, then forgets it", async () => {
    const d = deferred<string>();
    let runs = 0;
    const work = (): Promise<string> => {
      runs += 1;
      return d.promise;
    };
    const a = singleFlight("boom", work).catch((e: unknown) => e);
    const b = singleFlight("boom", work).catch((e: unknown) => e);
    const failure = new Error("nope");
    d.reject(failure);
    expect(await Promise.all([a, b])).toEqual([failure, failure]);
    expect(runs).toBe(1);
    expect(await singleFlight("boom", async () => "fresh")).toBe("fresh");
  });
});

describe("createTtlCache", () => {
  it("returns a value until its time is up, then forgets it", () => {
    let t = 1_000;
    const c = createTtlCache<string>({ ttlMs: 60_000, max: 10, now: () => t });
    c.set("k", "v");
    t += 59_999;
    expect(c.get("k")).toBe("v");
    t += 2;
    expect(c.get("k")).toBeUndefined();
    expect(c.size()).toBe(0);
  });

  it("removes the least recently used key past the maximum, and a read counts as a use", () => {
    const c = createTtlCache<number>({ ttlMs: 60_000, max: 3 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBe(1); // a is now the newest
    c.set("d", 4); // b is the oldest and goes
    expect([c.get("a"), c.get("b"), c.get("c"), c.get("d")]).toEqual([1, undefined, 3, 4]);
    expect(c.size()).toBe(3);
  });

  it("never holds more than the maximum however many keys are written", () => {
    const c = createTtlCache<number>({ ttlMs: 60_000, max: REPLY_MAX });
    for (let i = 0; i < REPLY_MAX * 3; i++) c.set(`k${i}`, i);
    expect(c.size()).toBe(REPLY_MAX);
  });
});

describe("replyKey", () => {
  const body = { rawText: "I keep getting headaches.", companionName: "Rumi" };
  const base = replyKey("userhash0000000a", "plan", body, "plan@2", "model-x");

  it("is the same for the same user, task, request, prompt version and model, whatever the key order", () => {
    expect(replyKey("userhash0000000a", "plan", { companionName: "Rumi", rawText: "I keep getting headaches." }, "plan@2", "model-x")).toBe(base);
  });

  it("changes with each part: a different user never shares a reply", () => {
    const keys = [
      replyKey("userhash0000000b", "plan", body, "plan@2", "model-x"),
      replyKey("userhash0000000a", "recap", body, "plan@2", "model-x"),
      replyKey("userhash0000000a", "plan", { ...body, rawText: "Different." }, "plan@2", "model-x"),
      replyKey("userhash0000000a", "plan", body, "plan@3", "model-x"),
      replyKey("userhash0000000a", "plan", body, "plan@2", "model-y"),
    ];
    expect(new Set([base, ...keys]).size).toBe(6);
  });

  it("holds no part of the user hash, the model or the text: it is a 64-character HMAC", () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).not.toContain("userhash");
  });

  it("the digest of the request moves with the memory facts in the body", () => {
    expect(requestDigest({ ...body, facts: [{ kind: "pacing", key: "extra_time" }] })).not.toBe(requestDigest(body));
  });

  it("joins parts so that moving a character between two parts changes the key", () => {
    expect(cacheKey(["ab", "c"])).not.toBe(cacheKey(["a", "bc"]));
  });
});

describe("sharedCacheKey: only replies with no user text, 08 section 5.3", () => {
  const ok = { scenario: "book", level: 2, companionName: "Rumi" };

  it("is sayit|scenario|level|promptVersion|model for a scenario at level 2 or 3", () => {
    expect(sharedCacheKey("sayit", ok, 0, "sayit@2", "m")).toBe("sayit|book|2|sayit@2|m");
    expect(sharedCacheKey("sayit", { ...ok, level: 3 }, 0, "sayit@2", "m")).toBe("sayit|book|3|sayit@2|m");
  });

  it("moves with the prompt version and the model, so a new prompt or model never serves an old answer", () => {
    expect(sharedCacheKey("sayit", ok, 0, "sayit@3", "m")).not.toBe(sharedCacheKey("sayit", ok, 0, "sayit@2", "m"));
    expect(sharedCacheKey("sayit", ok, 0, "sayit@2", "n")).not.toBe(sharedCacheKey("sayit", ok, 0, "sayit@2", "m"));
  });

  it.each([
    ["level 1 (a hint built for the person)", { ...ok, level: 1 }, 0],
    ["a clinician question the user typed", { level: 2, clinicianQuestion: "How often?", companionName: "Rumi" }, 0],
    ["a main concern the user wrote", { ...ok, mainConcern: "headaches" }, 0],
    ["symptoms the user wrote", { ...ok, symptomsInMyWords: ["tired"] }, 0],
    ["stated preferences in the prompt", ok, 1],
    ["no scenario", { level: 2, companionName: "Rumi" }, 0],
  ])("is null for %s", (_label, r, memoryItems) => {
    expect(sharedCacheKey("sayit", r, memoryItems, "sayit@2", "m")).toBeNull();
  });

  it("is null for every other task, even with a scenario-looking body", () => {
    for (const task of ["plan", "practice", "recap"] as const) expect(sharedCacheKey(task, ok, 0, "x@1", "m")).toBeNull();
  });

  it("empty concern text and an empty symptom list are not user text", () => {
    expect(sharedCacheKey("sayit", { ...ok, mainConcern: "  ", symptomsInMyWords: [] }, 0, "sayit@2", "m")).not.toBeNull();
  });
});
