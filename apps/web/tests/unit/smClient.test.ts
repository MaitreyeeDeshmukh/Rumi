import { describe, expect, it } from "vitest";
import { SmError, createSmClient } from "@/features/memory/smClient";
import { fakeSupermemory } from "./helpers/fakeSupermemory";

const KEY = "sm-key-SECRET-123";
const NS = "u_0123456789abcdef0123456789abcdef";
const make = (sm = fakeSupermemory(), timeoutMs?: number) => ({ sm, client: createSmClient({ fetchFn: sm.fetchFn, apiKey: KEY, timeoutMs }) });
const meta = { kind: "support_pref", key: "p1", v: 1 };

describe("smClient requests", () => {
  it("add, patch and delete hit the documented paths on the documented host with the bearer key", async () => {
    const { sm, client } = make();
    await client.add(NS, { id: "support_pref:p1", content: "Please speak slowly.", metadata: meta });
    await client.patch(NS, "support_pref:p1", { content: "Please speak slowly.", metadata: meta });
    await client.del(NS, ["support_pref:p1"]);
    expect(sm.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST /ns/${NS}/document`,
      `PATCH /ns/${NS}/document/support_pref%3Ap1`,
      `DELETE /ns/${NS}/document`,
    ]);
    expect(sm.calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    expect(sm.calls.every((c) => c.origin === "https://api.supermemory.ai")).toBe(true);
  });
});

describe("smClient namespace and path-id checks apply in every helper", () => {
  const bad = ["", "a/b", "../x", "u_x y", "u_x?y", "a".repeat(101), "u_\n"];
  it("rejects bad namespaces before any request", async () => {
    const { sm, client } = make();
    for (const ns of bad) {
      await expect(client.add(ns, { id: "a", content: "c", metadata: meta })).rejects.toThrow();
      await expect(client.patch(ns, "a", { content: "c", metadata: meta })).rejects.toThrow();
      await expect(client.del(ns, ["a"])).rejects.toThrow();
      await expect(client.listPage(ns, 1)).rejects.toThrow();
      await expect(client.listAll(ns)).rejects.toThrow();
      await expect(client.upsert(ns, "a", { content: "c", metadata: meta })).rejects.toThrow();
    }
    expect(sm.calls).toHaveLength(0);
  });

  it("rejects ids that could change a URL path, including dots", async () => {
    const { sm, client } = make();
    for (const id of ["..", ".", "a/b", "a b", "", "a".repeat(101), "x?y"]) {
      await expect(client.patch(NS, id, { content: "c", metadata: meta })).rejects.toThrow();
      await expect(client.add(NS, { id, content: "c", metadata: meta })).rejects.toThrow();
      await expect(client.upsert(NS, id, { content: "c", metadata: meta })).rejects.toThrow();
    }
    expect(sm.calls).toHaveLength(0);
  });

  it("rejects bad pages, non-flat metadata and content outside 1 to 500 characters", async () => {
    const { sm, client } = make();
    await expect(client.listPage(NS, 0)).rejects.toThrow();
    await expect(client.listPage(NS, 1.5)).rejects.toThrow();
    await expect(client.add(NS, { id: "a", content: "c", metadata: { k: null } as never })).rejects.toThrow();
    await expect(client.add(NS, { id: "a", content: "c", metadata: { k: { n: 1 } } as never })).rejects.toThrow();
    await expect(client.add(NS, { id: "a", content: "", metadata: meta })).rejects.toThrow();
    await expect(client.add(NS, { id: "a", content: "x".repeat(501), metadata: meta })).rejects.toThrow();
    await expect(client.patch(NS, "a", { content: "x".repeat(501), metadata: meta })).rejects.toThrow();
    expect(sm.calls).toHaveLength(0);
    await client.add(NS, { id: "a", content: "x".repeat(500), metadata: meta });
    expect(sm.calls).toHaveLength(1);
  });
});

describe("smClient upsert", () => {
  it("PATCH first, so a second write replaces instead of appending, and it says whether it created the document", async () => {
    const { sm, client } = make();
    expect(await client.upsert(NS, "support_pref:p1", { content: "one", metadata: meta })).toBe("created");
    expect(await client.upsert(NS, "support_pref:p1", { content: "two", metadata: { ...meta, v: 2 } })).toBe("patched");
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
  it("loops in batches of 100 and reports nothing failed when all were deleted", async () => {
    const { sm, client } = make();
    const ids = Array.from({ length: 250 }, (_, i) => `id_${i}`);
    for (const id of ids) sm.docs(NS).set(id, { content: "c", metadata: {} });
    expect(await client.del(NS, ids)).toEqual({ failed: [] });
    const sizes = sm.calls.filter((c) => c.method === "DELETE").map((c) => (c.body as { ids: string[] }).ids.length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(sm.docs(NS).size).toBe(0);
  });

  it("makes no request for an empty list", async () => {
    const { sm, client } = make();
    expect(await client.del(NS, [])).toEqual({ failed: [] });
    expect(sm.calls).toHaveLength(0);
  });

  it("ids go in the body, so an id with dots or odd characters is still deleted", async () => {
    const { sm, client } = make();
    sm.docs(NS).set("stray.v1", { content: "c", metadata: {} });
    sm.docs(NS).set("a b/c", { content: "c", metadata: {} });
    expect(await client.del(NS, ["stray.v1", "a b/c"])).toEqual({ failed: [] });
    expect(sm.docs(NS).size).toBe(0);
  });

  it("an id that is not a sensible string is reported failed without a request", async () => {
    const { sm, client } = make();
    const r = await client.del(NS, ["", "x".repeat(201)]);
    expect(r.failed).toHaveLength(2);
    expect(sm.calls).toHaveLength(0);
  });

  it("ids the server refuses inside a 200 come back as failed", async () => {
    const { sm, client } = make();
    sm.docs(NS).set("a", { content: "c", metadata: {} });
    sm.docs(NS).set("b", { content: "c", metadata: {} });
    sm.deleteReport = () => ({ count: 1, errors: [{ id: "a", error: "locked" }] });
    expect(await client.del(NS, ["a", "b"])).toEqual({ failed: ["a"] });
  });

  it("fewer deleted than asked, with no ids named, marks the whole batch as failed", async () => {
    const { sm, client } = make();
    sm.deleteReport = () => ({ count: 1, errors: [] });
    expect((await client.del(NS, ["a", "b", "c"])).failed).toEqual(["a", "b", "c"]);
    sm.deleteReport = () => ({ count: 3, errors: [] });
    expect((await client.del(NS, ["a", "b", "c"])).failed).toEqual([]);
  });

  it("an answer without count or errors is treated as done (the erase re-lists to check)", async () => {
    const { sm, client } = make();
    sm.deleteReport = () => ({});
    expect((await client.del(NS, ["a"])).failed).toEqual([]);
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

  it("a missing or renamed pagination field does not stop at page one: it pages until an empty page", async () => {
    const { sm } = make();
    for (let i = 0; i < 150; i++) sm.docs(NS).set(`junk${i}`, { content: "x", metadata: {} });
    const drifted = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await sm.fetchFn(input, init);
      if (!String(input).includes("/list/documents")) return res;
      const j = (await res.json()) as { documents: unknown[]; pagination: { totalPages: number } };
      return Response.json({ documents: j.documents, meta: { pages: j.pagination.totalPages } });
    }) as typeof fetch;
    const client = createSmClient({ fetchFn: drifted, apiKey: KEY });
    expect(await client.listAll(NS)).toHaveLength(150);
  });

  it("a bad response shape is an error, never an empty list", async () => {
    const odd = (async () => new Response(JSON.stringify({ surprise: true }), { status: 200 })) as typeof fetch;
    const client = createSmClient({ fetchFn: odd, apiKey: KEY });
    await expect(client.listAll(NS)).rejects.toBeInstanceOf(SmError);
  });

  it("a page far bigger than the page we asked for is a bad response", async () => {
    const huge = (async () => Response.json({ documents: Array.from({ length: 1001 }, (_, i) => ({ id: `d${i}` })), pagination: { totalPages: 1 } })) as typeof fetch;
    const client = createSmClient({ fetchFn: huge, apiKey: KEY });
    await expect(client.listPage(NS, 1)).rejects.toBeInstanceOf(SmError);
    const ok = (async () => Response.json({ documents: Array.from({ length: 1000 }, (_, i) => ({ id: `d${i}` })), pagination: { totalPages: 1 } })) as typeof fetch;
    expect((await createSmClient({ fetchFn: ok, apiKey: KEY }).listPage(NS, 1)).documents).toHaveLength(1000);
  });

  it("stops after a page limit instead of looping forever", async () => {
    const endless = (async () => new Response(JSON.stringify({ documents: [{ id: "a" }], pagination: { totalPages: 100000 } }), { status: 200 })) as typeof fetch;
    const client = createSmClient({ fetchFn: endless, apiKey: KEY });
    await expect(client.listAll(NS)).rejects.toBeInstanceOf(SmError);
  });
});

describe("smClient time budget", () => {
  it("sends nothing when the budget is used up, for every helper", async () => {
    const { sm, client } = make();
    const none = () => 0;
    await expect(client.listAll(NS, none)).rejects.toBeInstanceOf(SmError);
    await expect(client.listPage(NS, 1, none)).rejects.toBeInstanceOf(SmError);
    await expect(client.del(NS, ["a"], none)).rejects.toBeInstanceOf(SmError);
    await expect(client.add(NS, { id: "a", content: "c", metadata: meta }, none)).rejects.toBeInstanceOf(SmError);
    await expect(client.patch(NS, "a", { content: "c", metadata: meta }, none)).rejects.toBeInstanceOf(SmError);
    await expect(client.upsert(NS, "a", { content: "c", metadata: meta }, none)).rejects.toBeInstanceOf(SmError);
    expect(sm.calls).toHaveLength(0);
  });

  it("a request is cut off by the time left when that is shorter than the usual timeout", async () => {
    const { sm, client } = make();
    sm.delayMs = 3000;
    const started = Date.now();
    await expect(client.listAll(NS, () => 40)).rejects.toMatchObject({ message: expect.stringMatching(/timeout/i) });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("smClient errors", () => {
  it("never contain the response body or the key", async () => {
    const { sm, client } = make();
    sm.failStatus = 500;
    sm.failBody = `internal: Authorization Bearer ${KEY} secret-body-text`;
    for (const run of [
      () => client.add(NS, { id: "a", content: "c", metadata: meta }),
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
    const err = await client.listAll(NS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmError);
    expect((err as Error).message).not.toContain(KEY);
  });

  it("times out", async () => {
    const { sm, client } = make(fakeSupermemory(), 30);
    sm.delayMs = 500;
    const started = Date.now();
    const err = await client.listAll(NS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmError);
    expect((err as Error).message).toMatch(/timeout/i);
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("refuses to be built without a key", () => {
    expect(() => createSmClient({ fetchFn: fakeSupermemory().fetchFn, apiKey: "" })).toThrow();
  });
});
