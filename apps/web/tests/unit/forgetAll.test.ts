import { describe, expect, it } from "vitest";
import { forgetNamespace } from "@/features/memory/forgetAll";
import { createNamespaceQueue, createRemoteSync } from "@/features/memory/remoteSync";
import { createSmClient, type SmClient, type SmDoc } from "@/features/memory/smClient";
import { fakeSupermemory } from "./helpers/fakeSupermemory";

const NS = "u_0123456789abcdef0123456789abcdef";

/** A clock that only moves when the code sleeps, so the 10 second budget runs instantly. */
function clock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => void (t += ms, sleeps.push(ms)), sleeps };
}

const nope = async (): Promise<never> => {
  throw new Error("not used in this test");
};

function scripted(lists: (SmDoc[] | Error)[]) {
  const dels: string[][] = [];
  let i = 0;
  const unused = {
    add: nope,
    patch: nope,
    get: nope,
    upsert: nope,
    listPage: nope,
  };
  const client: SmClient = {
    listAll: async () => {
      const next = lists[Math.min(i++, lists.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    del: async (_ns: string, ids: readonly string[]) => void dels.push([...ids]),
    ...unused,
  };
  return { client, dels, listCalls: () => i };
}
const doc = (id: string): SmDoc => ({ id });

describe("forgetNamespace", () => {
  it("lists, deletes in batches of 100, and lists again", async () => {
    const sm = fakeSupermemory();
    for (let i = 0; i < 250; i++) sm.docs(NS).set(`id_${i}`, { content: "c", metadata: {} });
    const client = createSmClient({ fetchFn: sm.fetchFn, apiKey: "k" });
    const c = clock();
    expect(await forgetNamespace(NS, { client, ...c })).toBe("ok");
    expect(sm.docs(NS).size).toBe(0);
    const sizes = sm.calls.filter((x) => x.method === "DELETE").map((x) => (x.body as { ids: string[] }).ids.length);
    expect(sizes).toEqual([100, 100, 50]);
    const lastTwo = sm.calls.filter((x) => x.path.endsWith("/list/documents")).slice(-2);
    expect(lastTwo).toHaveLength(2);
  });

  it("an already empty namespace still needs two empty lists before it says ok", async () => {
    const s = scripted([[]]);
    expect(await forgetNamespace(NS, { client: s.client, ...clock() })).toBe("ok");
    expect(s.listCalls()).toBe(2);
    expect(s.dels).toEqual([]);
  });

  it("one empty list is not enough: a document that comes back resets the count", async () => {
    const s = scripted([[doc("a")], [], [doc("a")], [], []]);
    expect(await forgetNamespace(NS, { client: s.client, ...clock() })).toBe("ok");
    expect(s.listCalls()).toBe(5);
    expect(s.dels).toEqual([["a"], ["a"]]);
  });

  it("a list error between empty lists resets the count", async () => {
    const s = scripted([[], new Error("boom"), [], []]);
    expect(await forgetNamespace(NS, { client: s.client, ...clock() })).toBe("ok");
    expect(s.listCalls()).toBe(4);
  });

  it("when the second list is not empty for the whole budget it returns failed", async () => {
    const sm = fakeSupermemory();
    sm.docs(NS).set("support_pref:p1", { content: "c", metadata: {} });
    sm.stuckIds.add("support_pref:p1");
    const client = createSmClient({ fetchFn: sm.fetchFn, apiKey: "k" });
    const c = clock();
    expect(await forgetNamespace(NS, { client, ...c })).toBe("failed");
    expect(c.now()).toBeGreaterThanOrEqual(10_000);
    expect(c.now()).toBeLessThanOrEqual(11_000);
    expect(c.sleeps.every((ms) => ms === 1000)).toBe(true);
    expect(sm.docs(NS).size).toBe(1);
  });

  it("slow deletes that finish in time still end in ok", async () => {
    const sm = fakeSupermemory();
    for (let i = 0; i < 5; i++) sm.docs(NS).set(`id_${i}`, { content: "c", metadata: {} });
    sm.deleteLag = 3;
    const client = createSmClient({ fetchFn: sm.fetchFn, apiKey: "k" });
    expect(await forgetNamespace(NS, { client, ...clock() })).toBe("ok");
    expect(sm.docs(NS).size).toBe(0);
  });

  it("a delete that fails once is retried within the budget", async () => {
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
    expect(await forgetNamespace(NS, { client, ...clock() })).toBe("ok");
    expect(failed).toBe(true);
  });

  it("failing lists for the whole budget is failed, never ok", async () => {
    const sm = fakeSupermemory();
    sm.failStatus = 500;
    const client = createSmClient({ fetchFn: sm.fetchFn, apiKey: "k" });
    expect(await forgetNamespace(NS, { client, ...clock() })).toBe("failed");
  });

  it("a bad namespace is failed at once, with no request", async () => {
    const sm = fakeSupermemory();
    const client = createSmClient({ fetchFn: sm.fetchFn, apiKey: "k" });
    const c = clock();
    expect(await forgetNamespace("../evil", { client, ...c })).toBe("failed");
    expect(sm.calls).toHaveLength(0);
    expect(c.sleeps).toEqual([]);
  });

  it("runs after a sync that is already in flight on the same queue", async () => {
    const sm = fakeSupermemory();
    const client = createSmClient({ fetchFn: sm.fetchFn, apiKey: "k" });
    const queue = createNamespaceQueue();
    const sync = createRemoteSync(client, queue);
    const [, result] = await Promise.all([sync.syncFacts(NS, [{ kind: "support_pref", key: "p1" }]), forgetNamespace(NS, { client, queue, ...clock() })]);
    expect(result).toBe("ok");
    expect(sm.docs(NS).size).toBe(0);
    const methods = sm.calls.map((c) => c.method + (c.path.endsWith("/list/documents") ? ":list" : ""));
    expect(methods.slice(0, 3)).toEqual(["PATCH", "POST", "POST:list"]);
    expect(methods.slice(3)).toEqual(["POST:list", "DELETE", "POST:list", "POST:list"]);
  });
});
