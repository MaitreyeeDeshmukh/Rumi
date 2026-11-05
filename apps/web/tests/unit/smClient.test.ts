import { describe, expect, it } from "vitest";
import { SmError, createSmClient } from "@/features/memory/smClient";
import { fakeSupermemory } from "./helpers/fakeSupermemory";

const KEY = "sm-key-SECRET-123";
const NS = "u_0123456789abcdef0123456789abcdef";
const make = (sm = fakeSupermemory(), timeoutMs?: number) => ({ sm, client: createSmClient({ fetchFn: sm.fetchFn, apiKey: KEY, timeoutMs }) });
const meta = { kind: "support_pref", key: "p1", v: 1 };

describe("smClient requests", () => {
  it("add, get, patch and delete hit the documented paths with the bearer key", async () => {
    const { sm, client } = make();
    await client.add(NS, { id: "support_pref:p1", content: "Please speak slowly.", metadata: meta });
    await client.patch(NS, "support_pref:p1", { content: "Please speak slowly.", metadata: meta });
    expect((await client.get(NS, "support_pref:p1"))?.id).toBe("support_pref:p1");
    await client.del(NS, ["support_pref:p1"]);
    expect(sm.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST /ns/${NS}/document`,
      `PATCH /ns/${NS}/document/support_pref%3Ap1`,
      `GET /ns/${NS}/document/support_pref%3Ap1`,
      `DELETE /ns/${NS}/document`,
    ]);
    expect(sm.calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    expect(sm.calls.every((c) => c.origin === "https://api.supermemory.ai")).toBe(true);
  });

  it("get of a missing document is null, not an error", async () => {
    const { client } = make();
    expect(await client.get(NS, "nope")).toBeNull();
  });
});

describe("smClient namespace and id checks apply in every helper", () => {
  const bad = ["", "a/b", "../x", "u_x y", "u_x?y", "a".repeat(101), "u_\n"];
  it("rejects bad namespaces before any request", async () => {
    const { sm, client } = make();
    for (const ns of bad) {
      await expect(client.add(ns, { id: "a", content: "c", metadata: meta })).rejects.toThrow();
      await expect(client.patch(ns, "a", { content: "c", metadata: meta })).rejects.toThrow();
      await expect(client.get(ns, "a")).rejects.toThrow();
      await expect(client.del(ns, ["a"])).rejects.toThrow();
      await expect(client.listPage(ns, 1)).rejects.toThrow();
      await expect(client.listAll(ns)).rejects.toThrow();
      await expect(client.upsert(ns, "a", { content: "c", metadata: meta })).rejects.toThrow();
    }
    expect(sm.calls).toHaveLength(0);
  });

  it("rejects ids that could change the path, including dots", async () => {
    const { sm, client } = make();
    for (const id of ["..", ".", "a/b", "a b", "", "a".repeat(101), "x?y"]) {
      await expect(client.get(NS, id)).rejects.toThrow();
      await expect(client.patch(NS, id, { content: "c", metadata: meta })).rejects.toThrow();
      await expect(client.add(NS, { id, content: "c", metadata: meta })).rejects.toThrow();
      await expect(client.del(NS, [id])).rejects.toThrow();
    }
    expect(sm.calls).toHaveLength(0);
  });

  it("rejects bad pages and non-flat metadata", async () => {
    const { sm, client } = make();
    await expect(client.listPage(NS, 0)).rejects.toThrow();
    await expect(client.listPage(NS, 1.5)).rejects.toThrow();
    await expect(client.add(NS, { id: "a", content: "c", metadata: { k: null } as never })).rejects.toThrow();
    await expect(client.add(NS, { id: "a", content: "c", metadata: { k: { n: 1 } } as never })).rejects.toThrow();
    await expect(client.add(NS, { id: "a", content: "", metadata: meta })).rejects.toThrow();
    expect(sm.calls).toHaveLength(0);
  });
});

describe("smClient upsert", () => {
  it("PATCH first, so a second write replaces instead of appending", async () => {
    const { sm, client } = make();
    await client.upsert(NS, "support_pref:p1", { content: "one", metadata: meta });
    await client.upsert(NS, "support_pref:p1", { content: "two", metadata: { ...meta, v: 2 } });
    expect(sm.docs(NS).get("support_pref:p1")).toEqual({ content: "two", metadata: { ...meta, v: 2 } });
    expect(sm.calls.map((c) => c.method)).toEqual(["PATCH", "POST", "PATCH"]);
  });

  it("POSTs only on 404, and does not swallow other errors", async () => {
    const { sm, client } = make();
    sm.failStatus = 500;
    await expect(client.upsert(NS, "a", { content: "c", metadata: meta })).rejects.toBeInstanceOf(SmError);
    expect(sm.calls.map((c) => c.method)).toEqual(["PATCH"]);
  });

  it("always sends the full metadata on PATCH", async () => {
    const { sm, client } = make();
    await client.upsert(NS, "a", { content: "c", metadata: { kind: "help_level", key: "question", v: 1, level: 2 } });
    await client.upsert(NS, "a", { content: "c", metadata: { kind: "help_level", key: "question", v: 1, level: 3 } });
    const patch = sm.calls.filter((c) => c.method === "PATCH").at(-1)?.body as { metadata: Record<string, unknown> };
    expect(patch.metadata).toEqual({ kind: "help_level", key: "question", v: 1, level: 3 });
  });
});

describe("smClient delete", () => {
  it("loops in batches of 100", async () => {
    const { sm, client } = make();
    const ids = Array.from({ length: 250 }, (_, i) => `id_${i}`);
    for (const id of ids) sm.docs(NS).set(id, { content: "c", metadata: {} });
    await client.del(NS, ids);
    const sizes = sm.calls.filter((c) => c.method === "DELETE").map((c) => (c.body as { ids: string[] }).ids.length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(sm.docs(NS).size).toBe(0);
  });

  it("makes no request for an empty list", async () => {
    const { sm, client } = make();
    await client.del(NS, []);
    expect(sm.calls).toHaveLength(0);
  });
});

describe("smClient listing", () => {
  it("listAll walks every page", async () => {
    const { sm, client } = make();
    for (let i = 0; i < 230; i++) sm.docs(NS).set(`id_${i}`, { content: "c", metadata: { kind: "pacing" } });
    const docs = await client.listAll(NS);
    expect(docs).toHaveLength(230);
    expect(docs[0].metadata?.kind).toBe("pacing");
    expect(sm.calls.filter((c) => c.path.endsWith("/list/documents"))).toHaveLength(3);
  });

  it("an empty namespace lists as empty", async () => {
    const { client } = make();
    expect(await client.listAll(NS)).toEqual([]);
  });

  it("a bad response shape is an error, never an empty list", async () => {
    const odd = (async () => new Response(JSON.stringify({ surprise: true }), { status: 200 })) as typeof fetch;
    const client = createSmClient({ fetchFn: odd, apiKey: KEY });
    await expect(client.listAll(NS)).rejects.toBeInstanceOf(SmError);
  });

  it("stops after a page limit instead of looping forever", async () => {
    const endless = (async () => new Response(JSON.stringify({ documents: [{ id: "a" }], pagination: { totalPages: 100000 } }), { status: 200 })) as typeof fetch;
    const client = createSmClient({ fetchFn: endless, apiKey: KEY });
    await expect(client.listAll(NS)).rejects.toBeInstanceOf(SmError);
  });
});

describe("smClient errors", () => {
  it("never contain the response body or the key", async () => {
    const { sm, client } = make();
    sm.failStatus = 500;
    sm.failBody = `internal: Authorization Bearer ${KEY} secret-body-text`;
    for (const run of [
      () => client.add(NS, { id: "a", content: "c", metadata: meta }),
      () => client.get(NS, "a"),
      () => client.listAll(NS),
      () => client.del(NS, ["a"]),
    ]) {
      const err = await run().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SmError);
      expect(String((err as Error).message)).not.toContain("secret-body-text");
      expect(String((err as Error).message)).not.toContain(KEY);
      expect((err as SmError).status).toBe(500);
    }
  });

  it("a network failure does not leak the underlying message", async () => {
    const boom = (async () => {
      throw new Error(`connect failed with ${KEY}`);
    }) as typeof fetch;
    const client = createSmClient({ fetchFn: boom, apiKey: KEY });
    const err = await client.get(NS, "a").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmError);
    expect((err as Error).message).not.toContain(KEY);
  });

  it("times out", async () => {
    const { sm, client } = make(fakeSupermemory(), 30);
    sm.delayMs = 500;
    const started = Date.now();
    const err = await client.get(NS, "a").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmError);
    expect((err as Error).message).toMatch(/timeout/i);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("refuses to be built without a key", () => {
    expect(() => createSmClient({ fetchFn: fakeSupermemory().fetchFn, apiKey: "" })).toThrow();
  });
});
