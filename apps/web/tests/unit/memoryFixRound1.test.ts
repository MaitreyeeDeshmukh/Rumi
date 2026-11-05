import { describe, expect, it } from "vitest";
import { factsFromState, toWireRemovals } from "@/features/memory/persona";
import { handleConsent, handleFacts, handleForget, type RouteDeps } from "@/features/memory/server";
import { makeUserLimit, newUserLimiter } from "@/features/memory/serverDeps";
import { createSupabaseStore } from "@/features/memory/supabaseStore";
import { MemoryStoreError } from "@/features/memory/types";
import { FactsRequest } from "@/features/shared/schemas";
import { HttpError, readJson } from "@/lib/ai/http";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { parseState } from "@/lib/storage-schema";
import { defaultState } from "@/lib/storage";
import type { Logger } from "@/lib/log";
import { fakeMemoryDb } from "./helpers/fakeMemoryDb";
import { json, memoryDevice, practice, preset } from "./helpers/memoryDevice";

const T1 = "2026-11-05T10:00:00.000Z";
const SERVER = "2026-11-05T12:00:00.000Z";
const NOW = Date.parse(SERVER);
const facts = [{ kind: "support_pref", key: "p1", client_updated_at: T1 }];
const fast = { sleep: async () => undefined, random: () => 0 };

function spyLog() {
  const lines: { level: string; event: string; f?: Record<string, unknown> }[] = [];
  const createLog = (): Logger => ({
    info: (event, f) => void lines.push({ level: "info", event, f }),
    warn: (event, f) => void lines.push({ level: "warn", event, f }),
    error: (event, _e, f) => void lines.push({ level: "error", event, f }),
  });
  return { lines, createLog };
}
function setup(over: Partial<RouteDeps> = {}) {
  const db = fakeMemoryDb();
  db.consent = true;
  const deps: RouteDeps = {
    guard: () => undefined,
    requireUser: async () => ({ userId: "u1" }),
    getDb: async () => db,
    getFlag: async () => true,
    readJson,
    userLimit: () => undefined,
    now: () => NOW,
    ...over,
  };
  return { db, deps };
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const codeOf = async (res: Response): Promise<string> => ((await res.json()) as { error: { code: string } }).error.code;

describe("fix 1: consent is checked before ANY read or write on the facts route", () => {
  it("consent off and an empty batch: 403, and nothing is read or written (an empty write would pass RLS)", async () => {
    const { db, deps } = setup();
    db.consent = false;
    db.rows.set("support_pref:p1", { kind: "support_pref", key: "p1", level: null, client_updated_at: T1 });
    const res = await handleFacts(post("/api/memory/facts", { facts: [] }), deps);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("consent_required");
    expect(db.calls).toEqual(["select:core_consents"]);
  });

  it("consent off with removals: nothing is deleted", async () => {
    const { db, deps } = setup();
    db.consent = false;
    db.rows.set("support_pref:p1", { kind: "support_pref", key: "p1", level: null, client_updated_at: T1 });
    const removed = [{ kind: "support_pref", key: "p1", client_updated_at: SERVER }];
    expect((await handleFacts(post("/api/memory/facts", { facts: [], removed }), deps)).status).toBe(403);
    expect(db.rows.size).toBe(1);
    expect(db.calls).not.toContain("delete:persona_facts");
  });

  it("consent on and an empty batch is fine and returns what is stored", async () => {
    const { db, deps } = setup();
    db.rows.set("support_pref:p1", { kind: "support_pref", key: "p1", level: null, client_updated_at: T1 });
    const res = await handleFacts(post("/api/memory/facts", { facts: [] }), deps);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { facts: unknown[] }).facts).toHaveLength(1);
  });

  it("consent withdrawn while the request runs: the stored facts are not handed back", async () => {
    const { db, deps } = setup();
    db.rows.set("support_pref:p1", { kind: "support_pref", key: "p1", level: null, client_updated_at: T1 });
    const real = db.from.bind(db);
    db.from = (t) => {
      const table = real(t);
      return t === "persona_facts" ? { ...table, select: (c) => ((db.consent = false), table.select(c)) } : table;
    };
    const res = await handleFacts(post("/api/memory/facts", { facts }), deps);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("p1");
  });
});

describe("fix 2: forget revokes consent first and proves the result", () => {
  it("the order is revoke, erase, read consent back", async () => {
    const { db, deps } = setup();
    await handleForget(post("/api/memory/forget", {}), deps);
    expect(db.calls).toEqual(["upsert:core_consents", "rpc:persona_forget_all", "select:core_consents"]);
  });

  it("a push from another tab right after the revoke is refused by RLS, so nothing lands after the erase", async () => {
    const { db, deps } = setup();
    const store = createSupabaseStore(db, "u1", fast);
    const real = db.rpc.bind(db);
    db.rpc = async (fn, args) => {
      const r = await real(fn, args);
      if (fn === "persona_forget_all") expect(await store.upsertFacts([{ kind: "support_pref", key: "p2", client_updated_at: T1 }]).catch((e: MemoryStoreError) => e.reason)).toBe("consent_required");
      return r;
    };
    expect((await handleForget(post("/api/memory/forget", {}), deps)).status).toBe(200);
    expect(db.rows.size).toBe(0);
  });
});

describe("fix 3: removals", () => {
  it("a duplicate removal is refused", () => {
    const r = { kind: "support_pref", key: "p1", client_updated_at: T1 };
    expect(FactsRequest.safeParse({ facts: [], removed: [r, { ...r, client_updated_at: SERVER }] }).success).toBe(false);
    expect(FactsRequest.safeParse({ facts: [], removed: [r, { ...r, key: "p2" }] }).success).toBe(true);
  });

  it("all removals go out in ONE delete call, and each still only deletes older copies", async () => {
    const db = fakeMemoryDb();
    db.consent = true;
    const store = createSupabaseStore(db, "u1", fast);
    await store.upsertFacts([
      { kind: "support_pref", key: "p1", client_updated_at: T1 },
      { kind: "support_pref", key: "p2", client_updated_at: SERVER },
      { kind: "pacing", key: "extra_time", client_updated_at: T1 },
      { kind: "support_pref", key: "p3", client_updated_at: T1 },
    ]);
    db.calls.length = 0;
    await store.removeFacts([
      { kind: "support_pref", key: "p1", client_updated_at: SERVER },
      { kind: "support_pref", key: "p2", client_updated_at: T1 },
      { kind: "pacing", key: "extra_time", client_updated_at: SERVER },
    ]);
    expect(db.calls).toEqual(["delete:persona_facts"]);
    expect([...db.rows.keys()].sort()).toEqual(["support_pref:p2", "support_pref:p3"]);
  });

  it("no removals: no call at all", async () => {
    const db = fakeMemoryDb();
    await createSupabaseStore(db, "u1", fast).removeFacts([]);
    expect(db.calls).toEqual([]);
  });

  it("a removal that fails the allowlist never reaches the filter text", async () => {
    const db = fakeMemoryDb();
    const store = createSupabaseStore(db, "u1", fast);
    const evil = { kind: "support_pref", key: "p1),and(kind.neq.x", client_updated_at: T1 } as never;
    await expect(store.removeFacts([evil])).rejects.toMatchObject({ reason: "invalid" });
    expect(db.calls).toEqual([]);
  });
});

describe("fix 4: a limit per signed-in user on every memory route", () => {
  it("each route calls the user limit with the user id, after sign-in, before any database call", async () => {
    for (const [handler, path, body] of [
      [handleFacts, "/api/memory/facts", { facts }],
      [handleForget, "/api/memory/forget", {}],
      [handleConsent, "/api/memory/consent", { granted: true }],
    ] as const) {
      const seen: string[] = [];
      const { db, deps } = setup({
        userLimit: (id) => {
          seen.push(id);
          throw new HttpError(429, "rate_limited", 7);
        },
      });
      const res = await handler(post(path, body), deps);
      expect(res.status, path).toBe(429);
      expect(res.headers.get("retry-after")).toBe("7");
      expect(seen).toEqual(["u1"]);
      expect(db.calls, path).toEqual([]);
    }
  });

  it("not signed in is answered 401 before the user limit is touched", async () => {
    let called = false;
    const { deps } = setup({
      requireUser: async () => {
        throw new HttpError(403, "forbidden");
      },
      userLimit: () => void (called = true),
    });
    await handleFacts(post("/api/memory/facts", { facts }), deps);
    expect(called).toBe(false);
  });

  it("the real limiter refuses the 21st call in a minute for one user, not for another, and keys by hash", () => {
    const limiter = newUserLimiter();
    const limit = makeUserLimit(limiter);
    for (let i = 0; i < 20; i++) limit("user-a");
    expect(() => limit("user-a")).toThrow(HttpError);
    try {
      limit("user-a");
    } catch (e) {
      expect((e as HttpError).status).toBe(429);
      expect((e as HttpError).retryAfterSec).toBeGreaterThan(0);
    }
    expect(() => limit("user-b")).not.toThrow();
    expect(limiter.tracked().ips).toBe(2);
  });

  it("many users together are not capped by the limiter's instance window", () => {
    const limit = makeUserLimit(newUserLimiter());
    for (let i = 0; i < 500; i++) expect(() => limit(`user-${i}`)).not.toThrow();
  });

  it("the limiter is the shared one: a plain createRateLimiter would have capped the instance at 300", () => {
    const plain = makeUserLimit(createRateLimiter());
    let refused = 0;
    for (let i = 0; i < 500; i++) {
      try {
        plain(`user-${i}`);
      } catch {
        refused++;
      }
    }
    expect(refused).toBeGreaterThan(0);
  });
});

describe("fix 5: the request id from the browser", () => {
  const idOf = async (header: string | undefined) => {
    const { deps } = setup();
    const res = await handleFacts(post("/api/memory/facts", { facts }, header === undefined ? {} : { "x-request-id": header }), deps);
    return res.headers.get("x-request-id");
  };

  it("a well-formed id is kept", async () => {
    expect(await idOf("abcd-1234")).toBe("abcd-1234");
    expect(await idOf("a".repeat(64))).toBe("a".repeat(64));
  });

  it("anything else is replaced by a fresh uuid", async () => {
    for (const bad of ["short", "a".repeat(65), "has space in it", "../../etc/passwd", "id;DROP", "café-1234567", "a".repeat(8) + "\u0007"]) {
      expect(await idOf(bad), bad).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect(await idOf(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("fix 6: a wrong clock never makes sync fail for good", () => {
  it("the route stores a far-future stamp as the server's time and answers 200", async () => {
    const { db, deps } = setup();
    const { createLog, lines } = spyLog();
    deps.createLog = createLog;
    const res = await handleFacts(post("/api/memory/facts", { facts: [{ kind: "support_pref", key: "p1", client_updated_at: "2099-01-01T00:00:00.000Z" }] }), deps);
    expect(res.status).toBe(200);
    expect(db.rows.get("support_pref:p1")?.client_updated_at).toBe(SERVER);
    expect(lines.find((l) => l.event === "memory_stamps_clamped")?.f).toEqual({ count: 1 });
  });

  it("a clamped stamp does not pin the fact: a real change made later still wins", async () => {
    const { db, deps } = setup();
    await handleFacts(post("/api/memory/facts", { facts: [{ kind: "help_level", key: "question", level: 1, client_updated_at: "2099-01-01T00:00:00.000Z" }] }), deps);
    const hourLater = { ...deps, now: () => NOW + 3_600_000 };
    const res = await handleFacts(post("/api/memory/facts", { facts: [{ kind: "help_level", key: "question", level: 2, client_updated_at: "2026-11-05T12:30:00.000Z" }] }), hourLater);
    expect(res.status).toBe(200);
    expect(db.rows.get("help_level:question")?.level).toBe(2);
  });

  it("a stamp that is not a time is the only thing refused", async () => {
    const { db, deps } = setup();
    const res = await handleFacts(post("/api/memory/facts", { facts: [{ kind: "support_pref", key: "p1", client_updated_at: "soon" }] }), deps);
    expect(res.status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it("the browser sets a help-level time in the future to now before it sends", () => {
    const s = { ...defaultState(), sessions: [practice("s", "2099-01-01T00:00:00.000Z", { question: 2 })] };
    expect(factsFromState(s, T1)[0].updatedAt).toBe(T1);
  });

  it("the browser sets a stored fact time in the future to now", () => {
    const s = {
      ...defaultState(),
      supportCard: { id: "c", topQuestionIds: [], items: [preset("p1")] },
      persona: { facts: [{ id: "support_pref:p1", kind: "support_pref" as const, key: "p1", createdAt: T1, updatedAt: "2099-01-01T00:00:00.000Z" }] },
    };
    expect(factsFromState(s, T1).find((f) => f.id === "support_pref:p1")?.updatedAt).toBe(T1);
  });

  it("a pending removal time in the future is set to now; one that is not a time is not sent", () => {
    expect(toWireRemovals([{ id: "support_pref:p1", at: "2099-01-01T00:00:00.000Z" }], T1)[0].client_updated_at).toBe(T1);
    expect(toWireRemovals([{ id: "support_pref:p1", at: "garbage" }], T1)).toEqual([]);
  });

  it("stored times with an offset are saved in the form the server accepts", () => {
    const s = parseState({
      version: 1,
      persona: {
        facts: [{ kind: "support_pref", key: "p1", createdAt: "2026-11-01T00:00:00+02:00", updatedAt: "2026-11-05T10:00:00+02:00" }],
        removed: [{ id: "support_pref:p2", at: "2026-11-05T10:00:00+02:00" }],
      },
    });
    expect(s.persona.facts[0].updatedAt).toBe("2026-11-05T08:00:00.000Z");
    expect(s.persona.removed).toEqual([{ id: "support_pref:p2", at: "2026-11-05T08:00:00.000Z" }]);
  });

  it("end to end: a device whose practice is dated in the future and whose removal carries an offset still syncs", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: [preset("p1")] });
    d.store.update((x) => {
      x.sessions = [practice("s", "2099-06-01T00:00:00Z", { question: 3 })];
      x.persona.removed = [{ id: "support_pref:p3", at: "2026-11-05T09:00:00.000Z" }];
    });
    await d.actions.enableMemory();
    expect(d.state().settings.memoryOptIn).toBe(true);
    const row = db.rows.get("help_level:question");
    expect(row && Date.parse(row.client_updated_at)).toBeLessThanOrEqual(Date.parse(d.clock.at));
    expect(d.calls.at(-1)?.path).toBe("/api/memory/facts");
  });
});

describe("fix 7: 42501 is consent only for the write RPC", () => {
  const denied = { code: "42501", status: 403 };
  const reasonOf = async (p: Promise<unknown>) => ((await p.then(() => ({ reason: "resolved" }), (e: unknown) => e)) as MemoryStoreError).reason;

  it("on the upsert it is consent_required", async () => {
    const db = fakeMemoryDb();
    db.script = [denied];
    expect(await reasonOf(createSupabaseStore(db, "u1", fast).upsertFacts([{ kind: "support_pref", key: "p1", client_updated_at: T1 }]))).toBe("consent_required");
  });

  it("everywhere else it is permission_denied, and it is not retried", async () => {
    const calls: [string, (s: ReturnType<typeof createSupabaseStore>) => Promise<unknown>][] = [
      ["forget", (s) => s.forget()],
      ["search", (s) => s.search()],
      ["hasConsent", (s) => s.hasConsent()],
      ["setConsent", (s) => s.setConsent(true)],
      ["removeFacts", (s) => s.removeFacts([{ kind: "support_pref", key: "p1", client_updated_at: T1 }])],
    ];
    for (const [name, run] of calls) {
      const db = fakeMemoryDb();
      db.script = [denied];
      expect(await reasonOf(run(createSupabaseStore(db, "u1", fast))), name).toBe("permission_denied");
      expect(db.calls, name).toHaveLength(1);
    }
  });

  it("the route answers it as a loud 500 with an ERROR log that carries the code only", async () => {
    const { db, deps } = setup();
    const { createLog, lines } = spyLog();
    deps.createLog = createLog;
    db.script = [denied]; // the first call is the consent read
    const res = await handleFacts(post("/api/memory/facts", { facts }), deps);
    expect(res.status).toBe(500);
    expect(await codeOf(res)).toBe("permission_denied");
    const err = lines.find((l) => l.level === "error");
    expect(err?.event).toBe("memory_permission_denied");
    expect(err?.f).toEqual({ reason: "permission_denied", pgcode: "42501" });
    expect(lines.some((l) => l.event === "memory_consent_required")).toBe(false);
  });

  it("the browser keeps memory on and reports a failure, not 'memory is off'", async () => {
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: [preset("p1")] });
    await d.actions.enableMemory();
    d.answers.push(json(500, { error: { code: "permission_denied" } }), json(500, { error: { code: "permission_denied" } }), json(500, { error: { code: "permission_denied" } }));
    expect(await d.actions.syncPersona()).toMatchObject({ remote: "failed" });
    expect(d.state().settings.memoryOptIn).toBe(true);
  });

  it("not signed in (28000) is unauthorized and not retried; too many facts (54000) is invalid and not retried", async () => {
    for (const [err, reason] of [
      [{ code: "28000" }, "unauthorized"],
      [{ code: "54000" }, "invalid"],
    ] as const) {
      const db = fakeMemoryDb();
      db.consent = true;
      db.script = [err];
      expect(await reasonOf(createSupabaseStore(db, "u1", fast).upsertFacts([{ kind: "support_pref", key: "p1", client_updated_at: T1 }]))).toBe(reason);
      expect(db.calls).toHaveLength(1);
    }
  });
});
