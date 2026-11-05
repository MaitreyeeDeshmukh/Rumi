import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { createMemoryHandlers, memoryHandlers, type MemoryHandlerDeps } from "@/features/memory/memoryHandlers";
import { factText } from "@/features/memory/factText";
import { isRecoveryCode, newRecoveryCode } from "@/features/memory/recoveryCode";
import { tagFromCode } from "@/features/memory/tag";
import { RECOVERY_CODE_RE } from "@/features/shared/constants";
import { ForgetReply, ForgetRequest } from "@/features/shared/schemas";
import { getMemoryConfig, memoryEnabled, type MemoryConfig } from "@/lib/env";
import { guardRequest } from "@/lib/security/guardRequest";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { POST as factsPost } from "@/app/api/memory/facts/route";
import * as forgetRoute from "@/app/api/memory/forget/route";
import { fakeSupermemory, type FakeSm } from "./helpers/fakeSupermemory";

const SECRET = "t".repeat(40);
const SM_KEY = "sm-secret-key-123";
const CODE = "ABCDE-FGHJK-LMNPQ-RSTUV";
const OTHER = "ZZZZZ-22222-33333-44444";
const ORIGIN = "https://rumi.test";

const facts = (...f: object[]) => ({ facts: f });
const P1 = { kind: "support_pref", key: "p1" };
const P2 = { kind: "support_pref", key: "p2" };
const PACE = { kind: "pacing", key: "one_question" };
const HELP = { kind: "help_level", key: "question", level: 2 };

interface Setup {
  sm: FakeSm;
  h: ReturnType<typeof createMemoryHandlers>;
  sleeps: number[];
  config: Mock<() => MemoryConfig>;
}

function setup(over: Partial<MemoryHandlerDeps> = {}): Setup {
  const sm = fakeSupermemory();
  const clock = { t: 0 };
  const sleeps: number[] = [];
  const config = vi.fn<() => MemoryConfig>(() => ({ apiKey: SM_KEY, tagSecret: SECRET }));
  const h = createMemoryHandlers({
    enabled: () => true,
    config,
    fetchFn: sm.fetchFn,
    limiter: createRateLimiter({ limits: { perIp: 1000, perSession: 1000, perInstance: 1000, perUnknownIp: 1000 } }),
    forget: {
      now: () => clock.t,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
    },
    ...over,
  });
  return { sm, h, sleeps, config };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}, raw?: string): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-rumi-key": CODE, ...headers },
    body: raw ?? JSON.stringify(body),
  });
const sendFacts = (h: Setup["h"], body: unknown, headers?: Record<string, string>) => h.facts(post("/api/memory/facts", body, headers));
const sendForget = (h: Setup["h"], body: unknown = {}, headers?: Record<string, string>) => h.forget(post("/api/memory/forget", body, headers));
const ns = (code = CODE) => tagFromCode(code, SECRET);
const errorCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("flag off: nothing is reachable", () => {
  const off = () => setup({ enabled: () => false });

  it.each(["facts", "forget"] as const)("%s answers a fixed forbidden before any other step", async (route) => {
    const { h, sm, config } = off();
    const limiter = createRateLimiter({ limits: { perIp: 1, perSession: 1, perInstance: 1, perUnknownIp: 1 } });
    const guarded = createMemoryHandlers({ enabled: () => false, config, fetchFn: sm.fetchFn, limiter });
    for (const handler of [h, guarded]) {
      const r = await (route === "facts" ? sendFacts(handler, facts(P1)) : sendForget(handler));
      expect(r.status).toBe(404);
      expect(await errorCode(r)).toBe("forbidden");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    // even a request that would fail every other check gets the same answer, and the limiter was not used
    expect((await (route === "facts" ? guarded.facts(new Request(`${ORIGIN}/x`, { method: "POST" })) : guarded.forget(new Request(`${ORIGIN}/x`, { method: "POST" })))).status).toBe(404);
    expect(sm.calls).toHaveLength(0);
    expect(config).not.toHaveBeenCalled();
  });

  it("the real instance is off by default and never touches the network", async () => {
    vi.stubEnv("MEMORY_ENABLED", "");
    const spy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", spy);
    for (const route of [factsPost, forgetRoute.POST]) {
      const r = await route(post("/api/memory/facts", facts(P1)));
      expect(r.status).toBe(404);
      expect(await errorCode(r)).toBe("forbidden");
    }
    expect((await memoryHandlers.facts(post("/api/memory/facts", facts(P1)))).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("the flag is exactly '1': 'true', '0', ' 1' and unset are all off", () => {
    for (const v of ["true", "0", " 1", "yes", ""]) {
      vi.stubEnv("MEMORY_ENABLED", v);
      expect(memoryEnabled()).toBe(false);
    }
    vi.stubEnv("MEMORY_ENABLED", "1");
    expect(memoryEnabled()).toBe(true);
  });

  it("route files declare the node runtime, no static caching, and a long erase time", () => {
    expect(forgetRoute.runtime).toBe("nodejs");
    expect(forgetRoute.dynamic).toBe("force-dynamic");
    expect(forgetRoute.maxDuration).toBeGreaterThanOrEqual(30);
  });
});

describe("request checks (every route)", () => {
  const routes = [
    ["facts", sendFacts, facts(P1)],
    ["forget", sendForget, {}],
  ] as const;

  it.each(routes)("%s rejects a wrong origin, a cross-site fetch and a request with no origin header", async (_n, send, body) => {
    const { h, sm } = setup();
    expect((await send(h, body, { origin: "https://evil.test" })).status).toBe(403);
    expect((await send(h, body, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await send(h, body, { origin: "null" })).status).toBe(403);
    const bare = new Request(`${ORIGIN}/api/memory/x`, { method: "POST", headers: { "x-rumi-key": CODE }, body: JSON.stringify(body) });
    expect((await (send === sendFacts ? h.facts(bare) : h.forget(bare))).status).toBe(403);
    expect(sm.calls).toHaveLength(0);
  });

  it.each(routes)("%s rejects a missing or badly formed x-rumi-key", async (_n, send, body) => {
    const { h, sm } = setup();
    const noKey = new Request(`${ORIGIN}/api/memory/x`, { method: "POST", headers: { origin: ORIGIN }, body: JSON.stringify(body) });
    const missing = await (send === sendFacts ? h.facts(noKey) : h.forget(noKey));
    expect(missing.status).toBe(400);
    expect(await errorCode(missing)).toBe("bad_input");
    for (const bad of ["abcde-fghjk-lmnpq-rstuv", "ABCDE-FGHJK-LMNPQ-RSTU", "ABCDE-FGHJK-LMNPQ-RSTU0", "ABCDEFGHJKLMNPQRSTUV", "ABCDE-FGHJK-LMNPQ-RSTUVW", "ABCDE-FGHJK-LMNPQ-RSTUI", ""]) {
      const r = await send(h, body, { "x-rumi-key": bad });
      expect({ bad, status: r.status }).toEqual({ bad, status: 400 });
    }
    expect(sm.calls).toHaveLength(0);
  });

  it.each(routes)("%s rejects an oversized body, declared or streamed without a length", async (_n, send, body) => {
    const { h, sm } = setup();
    const big = JSON.stringify({ ...body, pad: "x".repeat(5000) });
    const declared = await send(h, body, { "content-length": "5000" });
    expect(declared.status).toBe(413);
    expect(await errorCode(declared)).toBe("too_large");
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const req = new Request(`${ORIGIN}/api/memory/x`, { method: "POST", headers: { origin: ORIGIN, "x-rumi-key": CODE }, body: stream, duplex: "half" } as RequestInit);
    expect((await (send === sendFacts ? h.facts(req) : h.forget(req))).status).toBe(413);
    expect(sm.calls).toHaveLength(0);
  });

  it.each(routes)("%s rejects a body that is not JSON, empty, or not an object", async (_n, send) => {
    const { h } = setup();
    const path = send === sendFacts ? "/api/memory/facts" : "/api/memory/forget";
    const run = (r: Request) => (send === sendFacts ? h.facts(r) : h.forget(r));
    expect((await run(post(path, null, {}, "{not json"))).status).toBe(400);
    expect((await run(post(path, null, {}, ""))).status).toBe(400);
    expect((await run(post(path, null, {}, "[]"))).status).toBe(400);
    expect((await run(post(path, null, {}, '"text"'))).status).toBe(400);
    expect((await run(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN, "x-rumi-key": CODE } }))).status).toBe(400);
  });

  it("facts rejects unknown fields, free text, unknown kinds and keys, duplicates and too many facts", async () => {
    const { h, sm } = setup();
    const bad: unknown[] = [
      { facts: [P1], extra: 1 },
      { facts: [{ ...P1, text: "Please speak slowly." }] },
      { facts: [{ ...P1, id: "support_pref:p1" }] },
      { facts: [{ kind: "diagnosis", key: "p1" }] },
      { facts: [{ kind: "support_pref", key: "p9" }] },
      { facts: [{ kind: "support_pref", key: "p1", level: 1 }] },
      { facts: [{ kind: "pacing", key: "p1" }] },
      { facts: [{ kind: "help_level", key: "question" }] },
      { facts: [{ kind: "help_level", key: "question", level: 7 }] },
      { facts: [{ kind: "help_level", key: "a b", level: 1 }] },
      { facts: [P1, P1] },
      { facts: Array.from({ length: 21 }, (_, i) => ({ kind: "support_pref", key: `p${i}` })) },
      { facts: "p1" },
      { facts: [null] },
      {},
    ];
    for (const body of bad) {
      const r = await sendFacts(h, body);
      expect({ body, status: r.status }).toEqual({ body, status: 400 });
      expect(await errorCode(r)).toBe("bad_input");
    }
    expect(sm.calls).toHaveLength(0);
  });

  it("a __proto__ key in the body does not reach the schema as a field", async () => {
    const { h } = setup();
    const r = await h.facts(post("/api/memory/facts", null, {}, '{"facts":[],"__proto__":{"polluted":true}}'));
    expect(r.status).toBe(200);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("forget accepts {} and a sensible sinceSyncMs, and rejects anything else", async () => {
    const { h } = setup();
    expect((await sendForget(h, {})).status).toBe(200);
    expect((await sendForget(h, { sinceSyncMs: 1234 })).status).toBe(200);
    for (const body of [{ sinceSyncMs: -1 }, { sinceSyncMs: "5" }, { sinceSyncMs: 600_001 }, { sinceSyncMs: null }, { other: 1 }, { sinceSyncMs: 1, other: 1 }]) {
      expect({ body, status: (await sendForget(h, body)).status }).toEqual({ body, status: 400 });
    }
    const huge = await h.forget(post("/api/memory/forget", null, {}, '{"sinceSyncMs":1e999}'));
    expect(huge.status).toBe(400);
  });

  it("ForgetRequest is strict, finite and bounded (schema alone)", () => {
    expect(ForgetRequest.safeParse({}).success).toBe(true);
    expect(ForgetRequest.safeParse({ sinceSyncMs: 0 }).success).toBe(true);
    expect(ForgetRequest.safeParse({ sinceSyncMs: 600_000 }).success).toBe(true);
    expect(ForgetRequest.safeParse({ sinceSyncMs: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(ForgetRequest.safeParse({ sinceSyncMs: Number.NaN }).success).toBe(false);
    expect(ForgetRequest.safeParse({ x: 1 }).success).toBe(false);
  });

  it("the rate limit applies and answers 429 with Retry-After", async () => {
    const limiter = createRateLimiter({ limits: { perIp: 2, perSession: 2, perInstance: 2, perUnknownIp: 2 } });
    const { h } = setup({ limiter });
    expect((await sendFacts(h, facts(P1))).status).toBe(200);
    expect((await sendFacts(h, facts(P1))).status).toBe(200);
    const r = await sendFacts(h, facts(P1));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await errorCode(r)).toBe("rate_limited");
  });
});

describe("one recovery code format", () => {
  it("guardRequest accepts exactly what isRecoveryCode accepts", () => {
    const samples = [CODE, OTHER, newRecoveryCode(), newRecoveryCode(), "abcde-fghjk-lmnpq-rstuv", "ABCDE-FGHJK-LMNPQ-RSTU0", "ABCDE-FGHJK-LMNPQ-RSTUV\n", " ABCDE-FGHJK-LMNPQ-RSTUV", "ABCDE_FGHJK_LMNPQ_RSTUV", "ABCDEFGHJKLMNPQRSTUV"];
    for (const s of samples) {
      const r = new Request(`${ORIGIN}/api/memory/facts`, { method: "POST", headers: { origin: ORIGIN, "x-rumi-key": s }, body: "{}" });
      let accepted = true;
      try {
        guardRequest(r, { limiter: createRateLimiter({ limits: { perIp: 1000, perSession: 1000, perInstance: 1000, perUnknownIp: 1000 } }) });
      } catch {
        accepted = false;
      }
      // Headers trims outer whitespace, so compare with the value the server actually sees.
      const seen = r.headers.get("x-rumi-key") ?? "";
      expect({ s, accepted }).toEqual({ s, accepted: isRecoveryCode(seen) });
    }
  });

  it("the shared regex is the one source", async () => {
    const { readFileSync } = await import("node:fs");
    const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), "utf8");
    expect(src("lib/security/guardRequest.ts")).not.toContain("A-HJ-NP-Z2-9");
    expect(src("lib/security/guardRequest.ts")).toContain("RECOVERY_CODE_RE");
    expect(src("features/memory/recoveryCode.ts")).toContain("RECOVERY_CODE_RE.test");
    expect(RECOVERY_CODE_RE.test(CODE)).toBe(true);
  });
});

describe("memory env getters", () => {
  it("getMemoryConfig names only the missing variables and never carries a value", () => {
    vi.stubEnv("SUPERMEMORY_API_KEY", "");
    vi.stubEnv("MEMORY_TAG_SECRET", "short-value-leak-check");
    let names: readonly string[] = [];
    let message = "";
    try {
      getMemoryConfig();
    } catch (e) {
      names = (e as { names: string[] }).names;
      message = (e as Error).message;
    }
    expect(names).toEqual(["SUPERMEMORY_API_KEY", "MEMORY_TAG_SECRET"]);
    expect(message).not.toContain("leak-check");
    vi.stubEnv("SUPERMEMORY_API_KEY", " k ");
    vi.stubEnv("MEMORY_TAG_SECRET", "s".repeat(32));
    expect(getMemoryConfig()).toEqual({ apiKey: "k", tagSecret: "s".repeat(32) });
  });

  it("a missing key or secret gives a fixed 503 and nothing from the config error", async () => {
    const { h, sm } = setup({
      config: () => {
        throw new Error("SUPERMEMORY_API_KEY and my-secret-value are missing");
      },
    });
    const r = await sendFacts(h, facts(P1));
    expect(r.status).toBe(503);
    const text = await r.text();
    expect(JSON.parse(text).error.code).toBe("ai_unavailable");
    expect(text).not.toMatch(/SUPERMEMORY|my-secret-value/);
    expect(sm.calls).toHaveLength(0);
  });
});

describe("round trip over a fake Supermemory", () => {
  it("stores the canonical sentence under an HMAC namespace, never the code", async () => {
    const { h, sm } = setup();
    const r = await sendFacts(h, facts(P2, PACE, HELP));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ saved: 3, rejected: 0 });
    const docs = sm.docs(ns());
    expect([...docs.keys()].sort()).toEqual(["help_level:question", "pacing:one_question", "support_pref:p2"]);
    expect(docs.get("support_pref:p2")?.content).toBe(factText("support_pref", "p2"));
    expect(docs.get("help_level:question")?.metadata).toMatchObject({ kind: "help_level", key: "question", level: 2 });
    // the code and the Supermemory key
    const wire = JSON.stringify(sm.calls.map((c) => [c.path, c.query, c.body]));
    expect(wire).not.toContain(CODE);
    expect(wire).not.toContain(SECRET);
    expect(sm.calls.every((c) => c.auth === `Bearer ${SM_KEY}`)).toBe(true);
    expect(sm.calls.every((c) => c.path.startsWith(`/ns/${ns()}/`))).toBe(true);
  });

  it("a second sync with fewer facts removes the old ones remotely", async () => {
    const { h, sm } = setup();
    await sendFacts(h, facts(P1, P2, PACE));
    const again = await sendFacts(h, facts(P1));
    expect(await again.json()).toEqual({ saved: 1, rejected: 0 });
    expect([...sm.docs(ns()).keys()]).toEqual(["support_pref:p1"]);
    expect((await (await sendFacts(h, facts())).json())).toEqual({ saved: 0, rejected: 0 });
    expect(sm.docs(ns()).size).toBe(0);
  });

  it("two codes never see each other's documents", async () => {
    const { h, sm } = setup();
    await sendFacts(h, facts(P1));
    await sendFacts(h, facts(P2), { "x-rumi-key": OTHER });
    expect([...sm.docs(ns()).keys()]).toEqual(["support_pref:p1"]);
    expect([...sm.docs(ns(OTHER)).keys()]).toEqual(["support_pref:p2"]);
    expect(ns()).not.toBe(ns(OTHER));
  });

  it("a Supermemory failure is a fixed 503; the upstream body, key and code never come back", async () => {
    const { h, sm } = setup();
    sm.failStatus = 500;
    sm.failBody = `boom ${SM_KEY} ${CODE}`;
    const r = await sendFacts(h, facts(P1));
    expect(r.status).toBe(503);
    const text = await r.text();
    expect(JSON.parse(text).error.code).toBe("ai_unavailable");
    expect(text).not.toMatch(/boom|sm-secret|ABCDE/);
  });

  it("answers are private JSON and carry the new session cookie", async () => {
    const { h } = setup();
    const r = await sendFacts(h, facts(P1));
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(r.headers.get("set-cookie")).toMatch(/^rumi_sid=/);
    const e = await sendFacts(h, { facts: [{ kind: "x", key: "y" }] });
    expect(e.headers.get("cache-control")).toBe("no-store");
  });
});

describe("forget: list, delete, list again", () => {
  it("erases only the caller's namespace and lists again after deleting", async () => {
    const { h, sm } = setup();
    await sendFacts(h, facts(P1, PACE));
    await sendFacts(h, facts(P2), { "x-rumi-key": OTHER });
    sm.calls.length = 0;
    const r = await sendForget(h);
    expect(ForgetReply.parse(await r.json())).toEqual({ status: "ok" });
    expect(sm.docs(ns()).size).toBe(0);
    expect([...sm.docs(ns(OTHER)).keys()]).toEqual(["support_pref:p2"]);
    const steps = sm.calls.map((c) => `${c.method}:${c.path.endsWith("/list/documents") ? "list" : "doc"}`);
    const firstDelete = steps.indexOf("DELETE:doc");
    expect(firstDelete).toBeGreaterThan(0);
    expect(steps.slice(firstDelete + 1).filter((s) => s === "POST:list").length).toBeGreaterThanOrEqual(3); // empty streak after the delete
    expect(sm.calls.every((c) => c.path.startsWith(`/ns/${ns()}/`))).toBe(true);
  });

  it("a document that will not go away is reported as failed, never ok", async () => {
    const { h, sm } = setup();
    await sendFacts(h, facts(P1, P2));
    sm.stuckIds.add("support_pref:p1");
    const r = await sendForget(h);
    expect(r.status).toBe(200);
    expect(ForgetReply.parse(await r.json())).toEqual({ status: "failed" });
  });

  it("an upstream outage during erase is failed, never ok", async () => {
    const { h, sm } = setup();
    await sendFacts(h, facts(P1));
    sm.failStatus = 503;
    expect(ForgetReply.parse(await (await sendForget(h)).json())).toEqual({ status: "failed" });
    expect(sm.docs(ns()).size).toBe(1);
  });

  it("sinceSyncMs lengthens the wait before the first list (and is the only thing it changes)", async () => {
    const a = setup();
    await sendForget(a.h, { sinceSyncMs: 0 });
    const b = setup();
    await sendForget(b.h, {});
    expect(a.sleeps[0]).toBe(5000);
    expect(b.sleeps[0]).toBe(4000);
  });

  it("an erase waits for a sync that is running in the same process", async () => {
    const sm = fakeSupermemory();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const slow = setup({
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (first) {
          first = false;
          await gate;
        }
        return sm.fetchFn(input, init);
      }) as typeof fetch,
    });
    const syncing = sendFacts(slow.h, facts(P1));
    const erasing = sendForget(slow.h);
    await new Promise((r) => setTimeout(r, 20));
    expect(slow.sleeps).toHaveLength(0); // the erase has not started its wait
    release();
    await syncing;
    expect(ForgetReply.parse(await (await erasing).json())).toEqual({ status: "ok" });
    expect(sm.docs(ns()).size).toBe(0);
    expect(sm.calls.some((c) => c.method === "PATCH" || (c.method === "POST" && !c.path.endsWith("/list/documents")))).toBe(true); // the sync really wrote first
  });
});

describe("nothing sensitive reaches a log line", () => {
  it("no console output in any success or failure path", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { h, sm } = setup();
    await sendFacts(h, facts(P1));
    await sendFacts(h, { facts: [{ kind: "x", key: "y" }] });
    sm.failStatus = 500;
    await sendFacts(h, facts(P2));
    await sendForget(h);
    await setup({ enabled: () => false }).h.facts(post("/api/memory/facts", facts(P1)));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
