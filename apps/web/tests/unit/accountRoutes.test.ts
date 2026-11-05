import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_TABLES } from "@/lib/auth/ownerTables";
import { AppError } from "@/lib/errors";


// The first import of the Supabase libraries is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
const ME = "00000000-0000-4000-8000-0000000000aa";
const REQ1 = "11111111-1111-4111-8111-111111111111";
const REQ2 = "22222222-2222-4222-8222-222222222222";
const FORGED = "00000000-0000-4000-8000-0000000000ff";
const SECRETS = ["secret-row-42", "secret socket detail"];

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  deleteUser: vi.fn(),
  counts: new Map<string, { count: number | null; error: unknown }>(),
  /** Answers used once, first, for a table; then `counts` applies. */
  countQueue: new Map<string, Array<{ count: number | null; error: unknown }>>(),
  eqCalls: [] as Array<[string, string, string]>,
  rpc: vi.fn(),
  getServerClient: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: m.requireUser }));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: m.logInfo, warn: vi.fn(), error: m.logError }) }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: m.getServerClient }));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    auth: { admin: { deleteUser: m.deleteUser } },
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => {
          m.eqCalls.push([table, column, value]);
          return Promise.resolve(m.countQueue.get(table)?.shift() ?? m.counts.get(table) ?? { count: 0, error: null });
        },
      }),
    }),
  }),
}));

import { POST as deleteAccount } from "@/app/api/account/delete/route";
import { GET as exportAccount } from "@/app/api/account/export/route";

const alice = { userId: ME, userHash: "a".repeat(16), isAnonymous: true };
const post = (headers: Record<string, string> = {}, body: unknown = {}): Request =>
  new Request("https://rumi.test/api/account/delete", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.7", "x-request-id": REQ1, ...headers },
    body: JSON.stringify(body),
  });
const get = (headers: Record<string, string> = {}): Request =>
  new Request("https://rumi.test/api/account/export", { headers: { "sec-fetch-site": "same-origin", "x-real-ip": "203.0.113.8", "x-request-id": REQ2, ...headers } });
const body = async (r: Response): Promise<{ error?: { code: string; message: string; requestId: string }; ok?: boolean }> => (await r.json()) as never;

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  // On Vercel the platform writes the forwarding headers that the address limit reads.
  vi.stubEnv("VERCEL", "1");
  m.requireUser.mockReset().mockResolvedValue(alice);
  m.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
  m.counts.clear();
  m.countQueue.clear();
  m.eqCalls.length = 0;
  m.rpc.mockReset();
  m.getServerClient.mockReset().mockResolvedValue({ rpc: m.rpc });
  m.logError.mockReset();
  m.logInfo.mockReset();
});

describe("POST /api/account/delete", () => {
  it("deletes the verified user, counts every owner table for that id, and answers ok", async () => {
    const r = await deleteAccount(post({ cookie: "sb-p-auth-token=abc; sb-p-auth-token.1=def; theme=dark" }));
    expect(r.status).toBe(200);
    expect(await body(r)).toEqual({ ok: true });
    expect(m.deleteUser).toHaveBeenCalledWith(ME);
    expect(m.eqCalls.map((c) => c[0]).sort()).toEqual([...OWNER_TABLES].sort());
    expect(m.eqCalls.every(([, column, value]) => column === "owner_id" && value === ME)).toBe(true);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-request-id")).toBe(REQ1);
    const cookies = r.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((c) => c.startsWith("sb-p-auth-token") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("uses the id from the token, never one the client sends", async () => {
    await deleteAccount(post({ "x-user-id": FORGED }, { userId: FORGED, user_id: FORGED }));
    expect(m.deleteUser).toHaveBeenCalledTimes(1);
    expect(m.deleteUser).toHaveBeenCalledWith(ME);
    expect(JSON.stringify(m.eqCalls)).not.toContain(FORGED);
  });

  it("a signed-out caller gets 401 and nothing is deleted, and their dead session cookies are expired", async () => {
    m.requireUser.mockRejectedValue(new AppError("unauthorized"));
    const r = await deleteAccount(post({ cookie: "sb-p-auth-token=dead; theme=dark" }));
    expect([r.status, (await body(r)).error?.code]).toEqual([401, "unauthorized"]);
    expect(m.deleteUser).not.toHaveBeenCalled();
    expect(r.headers.getSetCookie()).toEqual(["sb-p-auth-token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"]);
  });

  it("a repeat call after a successful delete is a 401 (a deleted user cannot pass requireUser) that clears the cookies again", async () => {
    await deleteAccount(post({ cookie: "sb-p-auth-token=abc" }));
    m.requireUser.mockRejectedValue(new AppError("unauthorized"));
    const r = await deleteAccount(post({ cookie: "sb-p-auth-token=abc" }));
    expect(r.status).toBe(401);
    expect(r.headers.getSetCookie()).toHaveLength(1);
  });

  it("a request from another site gets 403, nothing is deleted and no cookie is touched", async () => {
    const r = await deleteAccount(post({ "sec-fetch-site": "cross-site", origin: "https://evil.test", cookie: "sb-p-auth-token=abc" }));
    expect(r.status).toBe(403);
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(m.deleteUser).not.toHaveBeenCalled();
    expect(m.requireUser).not.toHaveBeenCalled();
  });

  it("rows left behind are an error, never ok, and the tables are named in the log, not in the answer; the cookies are expired anyway because the user is gone", async () => {
    m.counts.set("plan_items", { count: 2, error: null });
    const r = await deleteAccount(post({ cookie: "sb-p-auth-token=abc" }));
    expect(r.status).toBe(500);
    expect(r.headers.getSetCookie()).toHaveLength(1);
    const b = await body(r);
    expect(b.ok).toBeUndefined();
    expect(b.error?.code).toBe("internal");
    expect(JSON.stringify(b)).not.toContain("plan_items");
    expect(m.logError).toHaveBeenCalledWith("account_delete_rows_remain", expect.anything(), { tables: "plan_items" });
  });

  it("a count that fails or returns nothing is not zero: it is an error", async () => {
    m.counts.set("persona_facts", { count: null, error: { message: "secret-row-42" } });
    expect((await deleteAccount(post())).status).toBe(500);
    m.counts.set("persona_facts", { count: null, error: null });
    expect((await deleteAccount(post())).status).toBe(500);
  });

  it("a count that fails once is tried once more, and a second failure is the answer", async () => {
    m.countQueue.set("persona_facts", [{ count: null, error: { message: "timeout" } }]);
    const healed = await deleteAccount(post());
    expect(healed.status).toBe(200);
    expect(m.eqCalls.filter((c) => c[0] === "persona_facts")).toHaveLength(2);
    m.eqCalls.length = 0;
    m.countQueue.set("persona_facts", [
      { count: null, error: { message: "timeout" } },
      { count: null, error: { message: "timeout" } },
    ]);
    expect((await deleteAccount(post())).status).toBe(500);
    expect(m.eqCalls.filter((c) => c[0] === "persona_facts")).toHaveLength(2);
  });

  it("a clean first count is not repeated", async () => {
    await deleteAccount(post());
    expect(m.eqCalls).toHaveLength(OWNER_TABLES.length);
  });

  it("when the admin API fails the answer is 503, the user is told nothing about why, and the session is NOT expired (the user still exists)", async () => {
    m.deleteUser.mockResolvedValue({ data: null, error: { status: 500, message: "secret socket detail" } });
    const r = await deleteAccount(post({ cookie: "sb-p-auth-token=abc" }));
    expect(r.headers.getSetCookie()).toEqual([]);
    const text = JSON.stringify(await body(r));
    expect(r.status).toBe(503);
    for (const s of SECRETS) expect(text).not.toContain(s);
    expect(m.logError).toHaveBeenCalledWith("account_delete_failed", expect.any(AppError));
    expect(m.eqCalls).toEqual([]);
  });

  it("never writes the user id or hash to a log line", async () => {
    await deleteAccount(post());
    m.counts.set("plan_items", { count: 1, error: null });
    await deleteAccount(post());
    const logged = JSON.stringify([...m.logInfo.mock.calls, ...m.logError.mock.calls.map((c) => [c[0], c[2]])]);
    expect(logged).not.toContain(ME);
    expect(logged).not.toContain(alice.userHash);
  });
});

describe("GET /api/account/export", () => {
  it("returns what core_export_my_data returns for the caller, as a download", async () => {
    m.rpc.mockResolvedValue({ data: { plan_items: [{ text: "a" }], persona_facts: [] }, error: null });
    const req = get();
    const r = await exportAccount(req);
    expect(r.status).toBe(200);
    expect(m.getServerClient).toHaveBeenCalledWith(req);
    expect(m.rpc).toHaveBeenCalledWith("core_export_my_data");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="rumi-export.json"');
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-request-id")).toBe(REQ2);
    expect(JSON.parse(await r.text())).toEqual({ plan_items: [{ text: "a" }], persona_facts: [] });
  });

  it("a signed-out caller gets 401 and no data call is made", async () => {
    m.requireUser.mockRejectedValue(new AppError("unauthorized"));
    const r = await exportAccount(get());
    expect(r.status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("a database error is mapped, never echoed: 42501 is 403, a network fault is 503", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "secret-row-42" } });
    const denied = await exportAccount(get());
    expect(denied.status).toBe(403);
    m.rpc.mockResolvedValue({ data: null, error: new TypeError("Failed to fetch secret socket detail") });
    const down = await exportAccount(get());
    expect(down.status).toBe(503);
    for (const r of [denied, down]) {
      const text = JSON.stringify(await body(r));
      for (const s of SECRETS) expect(text).not.toContain(s);
    }
    expect(m.logError).toHaveBeenCalledWith("account_export_failed", expect.any(AppError));
  });
});

describe("OWNER_TABLES stays in step with the migrations", () => {
  const repoDir = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
  const dir = (process.env.RUMI_MIGRATIONS_DIR ?? repoDir).replace(/[\\/]*$/, "/");
  const present = existsSync(dir);
  // The migrations belong to the db lane. Where they are not visible these checks are skipped, unless CI (or RUMI_REQUIRE_LANES)
  // says every lane must be present: then a missing folder is a failure, not a silent pass. RUMI_MIGRATIONS_DIR points elsewhere.
  const required = Boolean(process.env.CI || process.env.RUMI_REQUIRE_LANES);

  const sql = (): string =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(`${dir}${f}`, "utf8"))
      .join("\n");
  const hasExport = present && /function public\.core_export_my_data/i.test(sql());

  it.runIf(required)("the migrations folder is present when lanes are required", () => {
    expect(present, `migrations not found at ${dir}; set RUMI_MIGRATIONS_DIR`).toBe(true);
  });

  it.skipIf(!present)("lists every table in the migrations that has an owner_id column", () => {
    const owned = ownerTablesOf(sql());
    expect(owned.length).toBeGreaterThan(0);
    expect([...OWNER_TABLES].sort()).toEqual(owned.sort());
  });

  it.skipIf(!hasExport)("is the same list core_export_my_data exports", () => {
    expect([...OWNER_TABLES].sort()).toEqual(exportedTablesOf(sql()).sort());
  });

  it("the parsers read the shapes they are meant to (so a format change fails here, not silently)", () => {
    const sample = [
      "create table public.a (",
      "  id int,",
      "  owner_id uuid",
      ");",
      "create table public.b (",
      "  id int",
      ") partition by range (id);",
      "create table public.d (",
      "  id int",
      ");",
      "create or replace function public.core_export_my_data()",
      "returns jsonb as $$",
      "begin",
      "  for t in select unnest(array[",
      "    'a', 'c'",
      "  ]) loop null; end loop;",
      "end $$;",
    ].join("\n");
    expect(ownerTablesOf(sample)).toEqual(["a"]);
    expect(exportedTablesOf(sample)).toEqual(["a", "c"]);
  });
});

function ownerTablesOf(sql: string): string[] {
  return [...sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\)[^;]*;/gi)].filter((t) => /\bowner_id\b/.test(t[2])).map((t) => t[1]);
}

/** The quoted names in the array of core_export_my_data: the tables the export reads. */
function exportedTablesOf(sql: string): string[] {
  const body = /function public\.core_export_my_data[\s\S]*?\bend \$\$;/i.exec(sql)?.[0] ?? "";
  const list = /array\[([^\]]*)\]/i.exec(body)?.[1] ?? "";
  return [...list.matchAll(/'(\w+)'/g)].map((t) => t[1]);
}
