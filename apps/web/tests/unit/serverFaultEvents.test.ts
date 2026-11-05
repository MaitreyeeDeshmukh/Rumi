/**
 * A 5xx on the memory routes, the account routes and the auth check leaves one app event (codes only) that the app_errors
 * alert can count. A 4xx (the caller's fault) leaves none. Response bodies are not part of this file: other tests pin them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

vi.setConfig({ testTimeout: 30_000 });

const m = vi.hoisted(() => ({
  record: vi.fn(),
  requireUser: vi.fn(),
  deleteUser: vi.fn(),
  rpc: vi.fn(),
  getServerClient: vi.fn(),
}));
vi.mock("@/lib/telemetry/sinks", () => ({ recordAppEvent: m.record, recordAiEvent: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: m.requireUser }));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: m.getServerClient }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    auth: { admin: { deleteUser: m.deleteUser } },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }),
  }),
}));

import { POST as deleteAccount } from "@/app/api/account/delete/route";
import { GET as exportAccount } from "@/app/api/account/export/route";
import { handleConsent, handleFacts, handleForget, type RouteDeps } from "@/features/memory/server";
import { readJson } from "@/lib/ai/http";
import { guardRequest } from "@/lib/security/guardRequest";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { fakeMemoryDb } from "./helpers/fakeMemoryDb";

const ME = { userId: "00000000-0000-4000-8000-0000000000aa", userHash: "a".repeat(16), isAnonymous: true };
const T1 = "2026-11-05T10:00:00.000Z";
const facts = [{ kind: "support_pref", key: "p1", client_updated_at: T1 }];
const headers = { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.7", "content-type": "application/json" };
const post = (path: string, body: unknown): Request => new Request(`https://rumi.test${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const throws = (error: unknown) => async (): Promise<never> => {
  throw error;
};

function memoryDeps(over: Partial<RouteDeps> = {}) {
  const db = fakeMemoryDb();
  db.consent = true;
  const deps: RouteDeps = {
    guard: async () => ({ userId: "u1" }),
    getDb: async () => db,
    getFlag: async () => true,
    readJson,
    userLimit: () => undefined,
    now: () => Date.parse("2026-11-05T12:00:00.000Z"),
    ...over,
  };
  return { db, deps };
}

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  m.record.mockReset();
  m.requireUser.mockReset().mockResolvedValue(ME);
  m.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  m.rpc.mockReset();
  m.getServerClient.mockReset().mockResolvedValue({ rpc: m.rpc });
});
afterEach(() => vi.unstubAllEnvs());

describe("memory routes", () => {
  it("a store outage (503) records one memory event with the route, status and a code, and no text", async () => {
    const { db, deps } = memoryDeps();
    db.script = [{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }];
    const res = await handleFacts(post("/api/memory/facts", { facts }), deps);
    expect(res.status).toBe(503);
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ source: "server", area: "memory", route: "/api/memory/facts", status: 503, code: expect.stringMatching(/^[a-z0-9_.:-]{1,60}$/) }));
  });

  it("a broken grant (500 permission_denied) is recorded too", async () => {
    const { db, deps } = memoryDeps();
    db.script = [{ code: "42501", status: 403 }];
    const res = await handleForget(post("/api/memory/forget", {}), deps);
    expect(res.status).toBe(500);
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ area: "memory", route: "/api/memory/forget", status: 500, code: "memory_permission_denied" }));
  });

  it("an unexpected throw in the work is recorded as a 503, without its text", async () => {
    const { deps } = memoryDeps({ getDb: throws(new Error("secret-detail")) });
    const res = await handleConsent(post("/api/memory/consent", { granted: true }), deps);
    expect(res.status).toBe(503);
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.record.mock.calls)).not.toContain("secret-detail");
  });

  it("caller faults leave no event: bad input, consent off, rate limit, signed out", async () => {
    const off = memoryDeps();
    off.db.consent = false;
    expect((await handleFacts(post("/api/memory/facts", { facts }), off.deps)).status).toBe(403);
    const ok = memoryDeps();
    expect((await handleFacts(post("/api/memory/facts", { nope: 1 }), ok.deps)).status).toBe(400);
    const limited = memoryDeps({ userLimit: () => { throw new AppError("rate_limited", { retryAfterSec: 5 }); } });
    expect((await handleFacts(post("/api/memory/facts", { facts }), limited.deps)).status).toBe(429);
    const out = memoryDeps({ guard: throws(new AppError("unauthorized")) });
    expect((await handleFacts(post("/api/memory/facts", { facts }), out.deps)).status).toBe(401);
    expect(m.record).not.toHaveBeenCalled();
  });

  it("a 5xx raised by the guard is not counted again here (guardRequest counted it)", async () => {
    const { deps } = memoryDeps({ guard: throws(new AppError("store_unavailable")) });
    expect((await handleFacts(post("/api/memory/facts", { facts }), deps)).status).toBe(503);
    expect(m.record).not.toHaveBeenCalled();
  });
});

describe("account routes", () => {
  it("delete: a failed removal (503) records one event", async () => {
    m.deleteUser.mockResolvedValue({ data: null, error: { message: "secret-detail" } });
    const res = await deleteAccount(post("/api/account/delete", {}));
    expect(res.status).toBe(503);
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ source: "server", area: "auth", code: "store_unavailable", route: "/api/account/delete", status: 503 }));
    expect(JSON.stringify(m.record.mock.calls)).not.toContain("secret-detail");
  });

  it("delete: signed out (401) and cross-site (403) leave no event", async () => {
    m.requireUser.mockRejectedValue(new AppError("unauthorized"));
    expect((await deleteAccount(post("/api/account/delete", {}))).status).toBe(401);
    const cross = new Request("https://rumi.test/api/account/delete", { method: "POST", headers: { ...headers, "sec-fetch-site": "cross-site" } });
    expect((await deleteAccount(cross)).status).toBe(403);
    expect(m.record).not.toHaveBeenCalled();
  });

  it("export: a database fault records one event; a signed-out caller records none", async () => {
    const get = (): Request => new Request("https://rumi.test/api/account/export", { headers });
    m.rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "secret-detail" } });
    const res = await exportAccount(get());
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ area: "auth", route: "/api/account/export", status: res.status }));
    m.record.mockReset();
    m.requireUser.mockRejectedValue(new AppError("unauthorized"));
    expect((await exportAccount(get())).status).toBe(401);
    expect(m.record).not.toHaveBeenCalled();
  });
});

describe("guardRequest auth faults", () => {
  const req = (): Request => new Request("https://rumi.test/api/plan", { method: "POST", headers });
  const guard = (error: unknown, requireAuth: boolean) => guardRequest(req(), { limiter: createRateLimiter(), requireAuth, authenticate: throws(error) });

  it.each([
    ["an outage", new AppError("store_unavailable"), 503],
    ["a configuration fault", new AppError("config"), 500],
  ])("%s is recorded once when the route can serve a signed-out caller", async (_n, error, status) => {
    const result = await guard(error, false);
    expect(result.user).toBeNull();
    expect(m.record).toHaveBeenCalledTimes(1);
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ source: "server", area: "auth", code: error.code, route: "/api/plan", status }));
  });

  it("is recorded once when the route needs a user, and the error still reaches the route", async () => {
    await expect(guard(new AppError("store_unavailable"), true)).rejects.toMatchObject({ code: "store_unavailable" });
    expect(m.record).toHaveBeenCalledTimes(1);
  });

  it("signed out (401) is normal and leaves no event", async () => {
    expect((await guard(new AppError("unauthorized"), false)).user).toBeNull();
    await expect(guard(new AppError("unauthorized"), true)).rejects.toMatchObject({ status: 401 });
    expect(m.record).not.toHaveBeenCalled();
  });

  it("a refusal (cross-site) is not an event", async () => {
    const cross = new Request("https://rumi.test/api/plan", { method: "POST", headers: { ...headers, "sec-fetch-site": "cross-site" } });
    await expect(guardRequest(cross, { limiter: createRateLimiter(), authenticate: null })).rejects.toMatchObject({ status: 403 });
    expect(m.record).not.toHaveBeenCalled();
  });

  it("an unexpected throw inside the guard becomes `internal` and is recorded", async () => {
    const limiter = createRateLimiter();
    limiter.check = () => {
      throw new Error("boom");
    };
    await expect(guardRequest(req(), { limiter, authenticate: null })).rejects.toMatchObject({ code: "internal" });
    expect(m.record).toHaveBeenCalledWith(expect.objectContaining({ area: "app", code: "internal", status: 500 }));
  });
});
