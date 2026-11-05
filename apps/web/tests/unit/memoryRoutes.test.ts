import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, handleConsent, handleFacts, handleForget, type RouteDeps } from "@/features/memory/server";
import { HttpError, readJson } from "@/lib/ai/http";
import { AppError } from "@/lib/errors";
import { fakeMemoryDb } from "./helpers/fakeMemoryDb";

const T1 = "2026-11-05T10:00:00.000Z";
const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const facts = [
  { kind: "support_pref", key: "p1", client_updated_at: T1 },
  { kind: "help_level", key: "question", level: 2, client_updated_at: T1 },
];

/** An AppError the way requireUser would throw it, without depending on the constructor's argument list. */
const appError = (code: string, status: number): AppError =>
  Object.assign(Object.create(AppError.prototype) as AppError, { code, status, expose: true, message: code });

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
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const answerOf = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown>, res });

describe("POST /api/memory/facts", () => {
  it("writes the batch and answers with what is stored, plus the request id", async () => {
    const { db, deps } = setup();
    const { status, body, res } = await answerOf(await handleFacts(post("/api/memory/facts", { facts }, { "x-request-id": "req-12345678" }), deps));
    expect(status).toBe(200);
    expect(body).toMatchObject({ saved: 2, rejected: 0 });
    expect((body.facts as unknown[]).length).toBe(2);
    expect(db.rows.size).toBe(2);
    expect(res.headers.get("x-request-id")).toBe("req-12345678");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("mints a request id when none came in", async () => {
    const { deps } = setup();
    const res = await handleFacts(post("/api/memory/facts", { facts }), deps);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("removals delete older stored copies, then the write goes through", async () => {
    const { db, deps } = setup();
    await handleFacts(post("/api/memory/facts", { facts }), deps);
    const later = "2026-11-05T11:00:00.000Z";
    const { status } = await answerOf(await handleFacts(post("/api/memory/facts", { facts: [], removed: [{ kind: "support_pref", key: "p1", client_updated_at: later }] }), deps));
    expect(status).toBe(200);
    expect([...db.rows.keys()]).toEqual(["help_level:question"]);
  });

  it("not signed in: 401 with the AppError answer, and the database is never touched", async () => {
    const { db, deps } = setup({
      requireUser: async () => {
        throw appError("unauthorized", 401);
      },
    });
    const { status, body } = await answerOf(await handleFacts(post("/api/memory/facts", { facts }), deps));
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe("unauthorized");
    expect(db.calls).toEqual([]);
  });

  it("the guard (origin, rate limit) runs first and its refusal is passed on, 429 with Retry-After", async () => {
    const { db, deps } = setup({
      guard: () => {
        throw new HttpError(429, "rate_limited", 12);
      },
    });
    const { status, res } = await answerOf(await handleFacts(post("/api/memory/facts", { facts }), deps));
    expect(status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    expect(db.calls).toEqual([]);
  });

  it("a cross-origin refusal (403) from the guard stays a 403", async () => {
    const { deps } = setup({
      guard: () => {
        throw new HttpError(403, "forbidden");
      },
    });
    expect((await handleFacts(post("/api/memory/facts", { facts }), deps)).status).toBe(403);
  });

  it("the guard receives the body limit", async () => {
    let seen = 0;
    const { deps } = setup({ guard: (_r, max) => void (seen = max) });
    await handleFacts(post("/api/memory/facts", { facts }), deps);
    expect(seen).toBe(MAX_BODY_BYTES);
  });

  it("a poisoned fact is a 400 and nothing is written", async () => {
    const { db, deps } = setup();
    const bad = [...facts, { kind: "support_pref", key: "I take sertraline", client_updated_at: T1 }];
    const { status, body } = await answerOf(await handleFacts(post("/api/memory/facts", { facts: bad }), deps));
    expect(status).toBe(400);
    expect((body.error as { code: string }).code).toBe("bad_input");
    expect(db.calls).toEqual([]);
  });

  it("more than 100 facts is a 413, never trimmed", async () => {
    const { db, deps } = setup();
    const many = Array.from({ length: 101 }, () => facts[0]);
    const { status } = await answerOf(await handleFacts(post("/api/memory/facts", { facts: many }), deps));
    expect(status).toBe(413);
    expect(db.calls).toEqual([]);
  });

  it("an oversized body is a 413 before it is parsed, and invalid JSON is a 400", async () => {
    const { db, deps } = setup();
    const huge = JSON.stringify({ facts: [], pad: "x".repeat(MAX_BODY_BYTES) });
    expect((await handleFacts(post("/api/memory/facts", huge), deps)).status).toBe(413);
    expect((await handleFacts(post("/api/memory/facts", "{not json"), deps)).status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it("consent off: 403 consent_required (the browser reads it as 'memory is off', not as an error)", async () => {
    const { db, deps } = setup();
    db.consent = false;
    const { status, body } = await answerOf(await handleFacts(post("/api/memory/facts", { facts }), deps));
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("consent_required");
    expect(db.rows.size).toBe(0);
  });

  it("flag off: nothing is written, answered 503 (cloud writes fail safe)", async () => {
    const { db, deps } = setup({ getFlag: async () => false });
    const { status } = await answerOf(await handleFacts(post("/api/memory/facts", { facts }), deps));
    expect(status).toBe(503);
    expect(db.calls).toEqual([]);
  });

  it("store down: 503 with a plain sentence, and no database text in the answer", async () => {
    const { db, deps } = setup();
    db.script = Array.from({ length: 4 }, () => ({ status: 500, message: "connection to server at 10.1.2.3 refused" }));
    const res = await handleFacts(post("/api/memory/facts", { facts }), deps);
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(text).not.toMatch(/10\.1\.2\.3|refused|connection/);
    expect(JSON.parse(text).error.message).toBe("Saving is paused. Your work is on this device.");
  });

  it("an unexpected throw inside is answered 503, not leaked", async () => {
    const { deps } = setup({
      getDb: async () => {
        throw new Error("secret stack detail");
      },
    });
    const res = await handleFacts(post("/api/memory/facts", { facts }), deps);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret stack detail");
  });

  it("a stale device's older write changes nothing and the answer shows the newer stored copy", async () => {
    const { deps } = setup();
    await handleFacts(post("/api/memory/facts", { facts: [{ kind: "help_level", key: "question", level: 3, client_updated_at: "2026-11-05T11:00:00.000Z" }] }), deps);
    const { body } = await answerOf(await handleFacts(post("/api/memory/facts", { facts: [{ kind: "help_level", key: "question", level: 0, client_updated_at: T1 }] }), deps));
    expect(body.saved).toBe(0);
    expect((body.facts as { level: number }[])[0].level).toBe(3);
  });
});

describe("POST /api/memory/forget", () => {
  it("erases, proves zero remain, revokes consent, answers ok", async () => {
    const { db, deps } = setup();
    await handleFacts(post("/api/memory/facts", { facts }), deps);
    const { status, body } = await answerOf(await handleForget(post("/api/memory/forget", {}), deps));
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(db.rows.size).toBe(0);
    expect(db.consent).toBe(false);
  });

  it("revokes consent FIRST, then erases, then checks both", async () => {
    const { db, deps } = setup();
    db.rows.set("support_pref:p1", { kind: "support_pref", key: "p1", level: null, client_updated_at: T1 });
    await handleForget(post("/api/memory/forget", {}), deps);
    expect(db.calls).toEqual(["upsert:core_consents", "rpc:persona_forget_all", "select:core_consents"]);
  });

  it("rows left behind: answered as a failure (503), never ok; consent is already off", async () => {
    const { db, deps } = setup();
    db.stuckRows = 2;
    const { status, body } = await answerOf(await handleForget(post("/api/memory/forget", {}), deps));
    expect(status).toBe(503);
    expect(body.status).toBeUndefined();
    expect(db.consent).toBe(false);
  });

  it("consent could not be revoked: nothing is erased and the answer is a failure, not ok", async () => {
    const { db, deps } = setup();
    db.rows.set("support_pref:p1", { kind: "support_pref", key: "p1", level: null, client_updated_at: T1 });
    db.script = [{ status: 400 }];
    const { status, body } = await answerOf(await handleForget(post("/api/memory/forget", {}), deps));
    expect(status).toBe(503);
    expect(body.status).toBeUndefined();
    expect(db.calls).toEqual(["upsert:core_consents"]);
    expect(db.rows.size).toBe(1);
  });

  it("the revoke did not stick (consent reads back on): the answer is a failure", async () => {
    const { db, deps } = setup();
    const real = db.from.bind(db);
    db.from = (t) => ({ ...real(t), upsert: async () => ({ data: null, error: null }) }); // reports success, changes nothing
    expect((await handleForget(post("/api/memory/forget", {}), deps)).status).toBe(503);
  });

  it("works with the sync flag off: a person can always delete", async () => {
    const { db, deps } = setup({ getFlag: async () => false });
    db.rows.set("support_pref:p1", { kind: "support_pref", key: "p1", level: null, client_updated_at: T1 });
    expect((await handleForget(post("/api/memory/forget", {}), deps)).status).toBe(200);
    expect(db.rows.size).toBe(0);
  });

  it("needs a user and the guard", async () => {
    const { db, deps } = setup({
      requireUser: async () => {
        throw appError("unauthorized", 401);
      },
    });
    expect((await handleForget(post("/api/memory/forget", {}), deps)).status).toBe(401);
    expect(db.calls).toEqual([]);
  });
});

describe("POST /api/memory/consent", () => {
  it("turns consent on and off for the account", async () => {
    const { db, deps } = setup();
    db.consent = false;
    expect((await answerOf(await handleConsent(post("/api/memory/consent", { granted: true }), deps))).body).toEqual({ granted: true });
    expect(db.consent).toBe(true);
    await handleConsent(post("/api/memory/consent", { granted: false }), deps);
    expect(db.consent).toBe(false);
  });

  it("works with the flag off, so consent can always be withdrawn", async () => {
    const { db, deps } = setup({ getFlag: async () => false });
    expect((await handleConsent(post("/api/memory/consent", { granted: false }), deps)).status).toBe(200);
    expect(db.consent).toBe(false);
  });

  it("anything but { granted: boolean } is a 400", async () => {
    const { db, deps } = setup();
    for (const b of [{}, { granted: "yes" }, { granted: true, kind: "cloud_sync" }, [], "x"]) {
      expect((await handleConsent(post("/api/memory/consent", b), deps)).status, JSON.stringify(b)).toBe(400);
    }
    expect(db.calls).toEqual([]);
  });
});
