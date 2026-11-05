import { describe, expect, it } from "vitest";
import { forgetNamespace, type ForgetDeps } from "@/features/memory/forgetAll";
import { createNamespaceQueue, createRemoteSync } from "@/features/memory/remoteSync";
import { createSmClient, type SmClient, type SmDoc } from "@/features/memory/smClient";
import { fakeSupermemory, type FakeSm } from "./helpers/fakeSupermemory";

const NS = "u_0123456789abcdef0123456789abcdef";
const doc = (id: string): SmDoc => ({ id });

/** A clock that only moves when the code sleeps (or when a test moves it), so waits cost nothing. */
function clock() {
  const c = { t: 0, sleeps: [] as number[] };
  return {
    c,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
}

const nope = async (): Promise<never> => {
  throw new Error("not used in this test");
};

/** A client whose lists are scripted; the last entry repeats. Records every call with the fake time. */
function scripted(lists: (SmDoc[] | Error)[], tk = clock()) {
  const dels: string[][] = [];
  const events: string[] = [];
  const listTimes: number[] = [];
  let i = 0;
  const client: SmClient = {
    listAll: async () => {
      events.push("list");
      listTimes.push(tk.c.t);
      const next = lists[Math.min(i++, lists.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    del: async (_ns, ids) => {
      dels.push([...ids]);
      return { failed: [] };
    },
    add: nope,
    patch: nope,
    upsert: nope,
    listPage: nope,
  };
  return { client, dels, events, listTimes, listCalls: () => i, tk };
}

function run(ns: string, client: SmClient, tk: ReturnType<typeof clock>, extra: Partial<ForgetDeps> = {}) {
  return forgetNamespace(ns, { client, queue: createNamespaceQueue(), now: tk.now, sleep: tk.sleep, ...extra });
}

function real(sm: FakeSm) {
  return createSmClient({ fetchFn: sm.fetchFn, apiKey: "k" });
}

describe("forgetNamespace: verified erasure", () => {
  it("lists, deletes in batches of 100, and lists again until it is empty", async () => {
    const sm = fakeSupermemory();
    for (let i = 0; i < 250; i++) sm.docs(NS).set(`id_${i}`, { content: "c", metadata: {} });
    const tk = clock();
    expect(await run(NS, real(sm), tk)).toBe("ok");
    expect(sm.docs(NS).size).toBe(0);
    const sizes = sm.calls.filter((x) => x.method === "DELETE").map((x) => (x.body as { ids: string[] }).ids.length);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it("an empty namespace still needs three empty lists, never fewer", async () => {
    const s = scripted([[]]);
    expect(await run(NS, s.client, s.tk)).toBe("ok");
    expect(s.listCalls()).toBe(3);
    expect(s.dels).toEqual([]);
  });

  it("the empty-list count is an option", async () => {
    const s = scripted([[]]);
    expect(await run(NS, s.client, s.tk, { emptyStreak: 5 })).toBe("ok");
    expect(s.listCalls()).toBe(5);
  });

  it("a document that comes back resets the count", async () => {
    const s = scripted([[doc("a")], [], [doc("a")], [], [], []]);
    expect(await run(NS, s.client, s.tk)).toBe("ok");
    expect(s.listCalls()).toBe(6);
    expect(s.dels).toEqual([["a"], ["a"]]);
  });

  it("waits before the first list, and lists are at least 1.5 s apart", async () => {
    const s = scripted([[]]);
    await run(NS, s.client, s.tk);
    expect(s.tk.c.sleeps[0]).toBe(4000);
    expect(s.listTimes[0]).toBe(4000);
    for (let i = 1; i < s.listTimes.length; i++) expect(s.listTimes[i] - s.listTimes[i - 1]).toBeGreaterThanOrEqual(1500);
  });

  it("a very recent sync lengthens the first wait; a long-ago, missing or invalid value never shortens it", async () => {
    const first = async (sinceSyncMs?: number) => {
      const s = scripted([[]]);
      await run(NS, s.client, s.tk, { sinceSyncMs });
      return s.tk.c.sleeps[0];
    };
    expect(await first(0)).toBe(5000);
    expect(await first(1000)).toBe(4000);
    expect(await first(2500)).toBe(4000);
    expect(await first(60_000)).toBe(4000);
    expect(await first(undefined)).toBe(4000);
    expect(await first(-5000)).toBe(4000);
    expect(await first(Number.NaN)).toBe(4000);
  });

  it("the wait and the lag are options for the measured values", async () => {
    const s = scripted([[]]);
    await run(NS, s.client, s.tk, { settleMs: 1000, lagMs: 9000, sinceSyncMs: 0, maxMs: 60_000 });
    expect(s.tk.c.sleeps[0]).toBe(9000);
  });
});

describe("forgetNamespace: indexing lag", () => {
  it("lag shorter than the window: ok, and nothing appears afterwards", async () => {
    const sm = fakeSupermemory();
    const tk = clock();
    sm.lag = { now: tk.now, ms: 3000 };
    const client = real(sm);
    await createRemoteSync(client, createNamespaceQueue()).syncFacts(NS, [{ kind: "support_pref", key: "p1" }]);
    expect(await run(NS, client, tk, { sinceSyncMs: 0 })).toBe("ok");
    tk.c.t += 60_000;
    expect(sm.docs(NS).size).toBe(0);
  });

  it("a document that shows up during the window is deleted and the count starts again", async () => {
    const sm = fakeSupermemory();
    const tk = clock();
    sm.lag = { now: tk.now, ms: 6000 };
    const client = real(sm);
    await createRemoteSync(client, createNamespaceQueue()).syncFacts(NS, [{ kind: "support_pref", key: "p1" }]);
    expect(await run(NS, client, tk, { lagMs: 0 })).toBe("ok");
    tk.c.t += 60_000;
    expect(sm.docs(NS).size).toBe(0);
    const lists = sm.calls.filter((c) => c.path.endsWith("/list/documents")).length;
    expect(lists).toBeGreaterThanOrEqual(6);
  });

  it("a lag that cannot be covered inside the budget is failed at once, with no request", async () => {
    const sm = fakeSupermemory();
    const tk = clock();
    expect(await run(NS, real(sm), tk, { lagMs: 25_000, sinceSyncMs: 0 })).toBe("failed");
    expect(sm.calls).toHaveLength(0);
  });

  it("a wait that leaves too little time to verify is failed, not ok", async () => {
    const s = scripted([[]]);
    expect(await run(NS, s.client, s.tk, { lagMs: 19_000, sinceSyncMs: 0 })).toBe("failed");
    expect(s.listCalls()).toBeLessThan(3);
  });
});

describe("forgetNamespace: failure and the time budget", () => {
  it("a stuck document is failed inside the budget", async () => {
    const sm = fakeSupermemory();
    sm.docs(NS).set("support_pref:p1", { content: "c", metadata: {} });
    sm.stuckIds.add("support_pref:p1");
    const tk = clock();
    expect(await run(NS, real(sm), tk)).toBe("failed");
    expect(tk.c.t).toBeGreaterThanOrEqual(20_000);
    expect(tk.c.t).toBeLessThanOrEqual(21_500);
    expect(sm.docs(NS).size).toBe(1);
  });

  it("no request starts after the deadline, even when every request is slow", async () => {
    const sm = fakeSupermemory();
    for (let i = 0; i < 5; i++) sm.docs(NS).set(`id_${i}`, { content: "c", metadata: {} });
    const tk = clock();
    const startedAt: number[] = [];
    sm.onRequest = () => {
      startedAt.push(tk.c.t);
      tk.c.t += 8000; // each request takes 8 s on the fake clock
    };
    expect(await run(NS, real(sm), tk)).toBe("failed");
    expect(startedAt.length).toBeGreaterThan(0);
    for (const t of startedAt) expect(t).toBeLessThan(20_000);
    expect(startedAt.length).toBeLessThanOrEqual(3);
  });

  it("a request is cut off by the time that is left, not by the full 8 s", async () => {
    const sm = fakeSupermemory();
    sm.delayMs = 5000;
    const tk = clock();
    const started = Date.now();
    expect(await run(NS, real(sm), tk, { maxMs: 4040, lagMs: 0 })).toBe("failed");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("failing lists for the whole budget is failed, never ok", async () => {
    const sm = fakeSupermemory();
    sm.failStatus = 500;
    expect(await run(NS, real(sm), clock())).toBe("failed");
  });

  it("a list error between empty lists resets the count", async () => {
    const s = scripted([[], [], new Error("boom"), [], [], []]);
    expect(await run(NS, s.client, s.tk)).toBe("ok");
    expect(s.listCalls()).toBe(6);
  });

  it("a delete that fails once is retried inside the budget", async () => {
    const sm = fakeSupermemory();
    sm.docs(NS).set("a", { content: "c", metadata: {} });
    let failed = false;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE" && !failed) {
        failed = true;
        return new Response("no", { status: 500 });
      }
      return sm.fetchFn(input, init);
    }) as typeof fetch;
    const client = createSmClient({ fetchFn: flaky, apiKey: "k" });
    expect(await run(NS, client, clock())).toBe("ok");
    expect(failed).toBe(true);
  });

  it("a bad namespace is failed at once, with no request and no wait", async () => {
    const sm = fakeSupermemory();
    const tk = clock();
    expect(await run("../evil", real(sm), tk)).toBe("failed");
    expect(sm.calls).toHaveLength(0);
    expect(tk.c.sleeps).toEqual([]);
  });

  it("an odd remote id is still deleted, so one stray never blocks the erase", async () => {
    const sm = fakeSupermemory();
    sm.docs(NS).set("support_pref:p1", { content: "x", metadata: {} });
    sm.docs(NS).set("stray.v1", { content: "x", metadata: {} });
    expect(await run(NS, real(sm), clock())).toBe("ok");
    expect(sm.docs(NS).size).toBe(0);
  });
});

describe("forgetNamespace: 429 backs off", () => {
  function limited(first: number) {
    const sm = fakeSupermemory();
    let lists = 0;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/list/documents") && lists++ < first) return new Response("slow down", { status: 429 });
      return sm.fetchFn(input, init);
    }) as typeof fetch;
    return createSmClient({ fetchFn, apiKey: "k" });
  }

  it("doubles the wait on each 429, caps it, and goes back to normal after a good answer", async () => {
    const tk = clock();
    expect(await run(NS, limited(4), tk, { maxMs: 90_000 })).toBe("ok");
    expect(tk.c.sleeps.slice(0, 6)).toEqual([4000, 3000, 6000, 8000, 8000, 1500]);
  });

  it("other errors do not escalate the wait", async () => {
    const sm = fakeSupermemory();
    sm.failStatus = 500;
    const tk = clock();
    await run(NS, real(sm), tk);
    expect(new Set(tk.c.sleeps.slice(1, -1))).toEqual(new Set([1500]));
  });

  it("a 429 that never stops is failed inside the budget", async () => {
    const tk = clock();
    expect(await run(NS, limited(1000), tk)).toBe("failed");
    expect(tk.c.t).toBeLessThanOrEqual(20_000 + 1);
  });
});

describe("forgetNamespace: one queue per process", () => {
  it("runs after a sync that is already in flight on the same queue", async () => {
    const sm = fakeSupermemory();
    const client = real(sm);
    const queue = createNamespaceQueue();
    const sync = createRemoteSync(client, queue);
    const tk = clock();
    const [, result] = await Promise.all([
      sync.syncFacts(NS, [{ kind: "support_pref", key: "p1" }]),
      forgetNamespace(NS, { client, queue, now: tk.now, sleep: tk.sleep }),
    ]);
    expect(result).toBe("ok");
    expect(sm.docs(NS).size).toBe(0);
    const methods = sm.calls.map((c) => c.method + (c.path.endsWith("/list/documents") ? ":list" : ""));
    expect(methods.slice(0, 4)).toEqual(["PATCH", "POST", "PATCH", "POST:list"]);
    expect(methods.slice(4, 6)).toEqual(["POST:list", "DELETE"]);
  });
});
