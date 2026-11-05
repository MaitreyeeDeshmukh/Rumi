/**
 * Chaos: identity and consent go wrong. Expired JWT, anonymous sign-in disabled or rate limited, consent revoked, Supabase
 * unreachable while a server route checks the user. Every failure must become a short literal sentence and a 401/403/429-style
 * code, never the raw error text. Written against the frozen interfaces (addendum section 3); runs when the auth and
 * persona lanes are merged.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describeWhen } from "./lanes";
import { loadLane, type MapErrorModule, type MemoryStoreModule, type RequireUserModule } from "./frozen";
import { captureLogs, ERR_MESSAGE, expectNoLeak, post, type Logs } from "./fakes";
import { fakeSupabase, installSupabase, type Mode } from "./supabaseFake";

let logs: Logs;
beforeEach(() => {
  logs = captureLogs();
  vi.resetModules();
});
afterEach(() => {
  logs.stop();
  vi.useRealTimers();
  for (const m of ["server-only", "@/lib/supabase/admin", "@/lib/supabase/server", "next/server"]) vi.doUnmock(m);
});

const words = (s: string): number => s.trim().split(/\s+/).length;

// Waiting for lane auth: src/features/auth/mapError.ts
describeWhen("auth", ["features/auth/mapError"], "chaos: Supabase errors become plain sentences", () => {
  const load = () => loadLane<MapErrorModule>("features/auth/mapError");

  /** [name, the error as supabase-js or fetch would raise it, code the mapper must answer with]. */
  const cases: [string, unknown, string | RegExp][] = [
    ["expired JWT", { status: 401, code: "bad_jwt", message: `JWT expired ${ERR_MESSAGE}` }, "unauthorized"],
    ["refresh token reused or invalid", { status: 400, code: "refresh_token_not_found", message: `Invalid Refresh Token ${ERR_MESSAGE}` }, "unauthorized"],
    ["anonymous sign-in disabled", { status: 422, code: "anonymous_provider_disabled", message: `Anonymous sign-ins are disabled ${ERR_MESSAGE}` }, /^(unauthorized|forbidden|store_unavailable)$/],
    ["sign-in rate limited (30 per hour per IP)", { status: 429, code: "over_request_rate_limit", message: `rate limit ${ERR_MESSAGE}` }, "rate_limited"],
    ["captcha failed", { status: 400, code: "captcha_failed", message: `captcha ${ERR_MESSAGE}` }, /^(forbidden|unauthorized|bad_input)$/],
    ["consent revoked (row security 42501)", { code: "42501", message: `new row violates row-level security policy ${ERR_MESSAGE}` }, "consent_required"],
    ["duplicate (23505)", { code: "23505", message: `duplicate key ${ERR_MESSAGE}` }, "conflict"],
    ["missing parent row (23503)", { code: "23503", message: `foreign key ${ERR_MESSAGE}` }, /^(conflict|bad_input|not_found)$/],
    ["check violation (23514)", { code: "23514", message: `check constraint ${ERR_MESSAGE}` }, "bad_input"],
    ["network failure", new TypeError(`fetch failed ${ERR_MESSAGE}`), /^(store_unavailable|ai_unavailable|internal)$/],
    ["Supabase 5xx", { status: 503, message: `upstream ${ERR_MESSAGE}` }, /^(store_unavailable|internal)$/],
  ];

  it.each(cases)("%s: mapped code, one short literal sentence, no raw text", async (_name, error, code) => {
    const { mapSupabaseError } = await load();
    const mapped = mapSupabaseError(error);
    if (typeof code === "string") expect(mapped.code).toBe(code);
    else expect(mapped.code).toMatch(code);
    expect(mapped.message).not.toContain(ERR_MESSAGE);
    expect(words(mapped.message), mapped.message).toBeLessThanOrEqual(15);
    expect(mapped.message).toMatch(/^[A-Z][^.!?]*[.!?]$/);
  });

  it.each([[null], [undefined], ["a string"], [42], [{}], [{ message: ERR_MESSAGE }], [new Error(ERR_MESSAGE)]])("an unknown thrown value (%#) maps to a safe default, never a throw", async (value) => {
    const { mapSupabaseError } = await load();
    const mapped = mapSupabaseError(value);
    expect(mapped.code).toBeTruthy();
    expect(mapped.message).not.toContain(ERR_MESSAGE);
    expect(words(mapped.message)).toBeLessThanOrEqual(15);
  });
});

// Waiting for lane auth: src/lib/auth/requireUser.ts
describeWhen("auth", ["lib/auth/requireUser"], "chaos: a server route checks the user while auth is broken", () => {
  async function load(mode: Mode, user: { id: string; is_anonymous: boolean } | null = null) {
    const fake = fakeSupabase(mode);
    fake.user = user;
    installSupabase(fake);
    return loadLane<RequireUserModule>("lib/auth/requireUser");
  }
  /** What requireUser threw: an AppError-shaped object with a code and status, and never a message that carries internals. */
  async function thrown(fn: () => Promise<unknown>): Promise<{ code: string; status: number; message: string }> {
    try {
      await fn();
    } catch (e) {
      return e as { code: string; status: number; message: string };
    }
    throw new Error("requireUser did not throw");
  }

  it("no session: 401 unauthorized", async () => {
    const { requireUser } = await load("ok", null);
    const e = await thrown(() => requireUser(post()));
    expect(e).toMatchObject({ code: "unauthorized", status: 401 });
  });

  it("expired or rejected token (auth answers an error): refused as unauthorized or store_unavailable, raw text not exposed", async () => {
    const { requireUser } = await load("error");
    const e = await thrown(() => requireUser(post()));
    expect([401, 503]).toContain(e.status);
    expect(e.code).toMatch(/^(unauthorized|store_unavailable)$/);
    expect(e.message).not.toContain(ERR_MESSAGE);
    expectNoLeak(logs, "", false);
  });

  it("auth unreachable: refuses (401 or 503), never lets the request through as someone, never leaks", async () => {
    const { requireUser } = await load("down", { id: "11111111-2222-4333-8444-555555555555", is_anonymous: true });
    const e = await thrown(() => requireUser(post()));
    expect([401, 503]).toContain(e.status);
    expect(e.message).not.toContain(ERR_MESSAGE);
    expectNoLeak(logs, "", false);
  });

  it("auth hanging: the check ends (does not hang the route) and refuses", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { requireUser } = await load("hang");
    const pending = thrown(() => requireUser(post()));
    await vi.advanceTimersByTimeAsync(15_000);
    expect([401, 503]).toContain((await pending).status);
  });

  it("a good anonymous session returns the id, a hash that is not the id, and isAnonymous", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const { requireUser } = await load("ok", { id, is_anonymous: true });
    const u = await requireUser(post());
    expect(u).toMatchObject({ userId: id, isAnonymous: true });
    expect(u.userHash).toMatch(/^(u:)?[0-9a-f]{16}$/);
    expect(u.userHash).not.toContain(id.slice(0, 8));
  });
});

// Waiting for lane persona: src/features/memory/supabaseStore.ts
describeWhen("persona", ["features/memory/supabaseStore"], "chaos: reading persona memory while Supabase is broken", () => {
  it.each(["down", "error", "hang"] as Mode[])("store %s: getMemoryFacts gives [] within its 1500 ms cap and never throws", async (mode) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fake = fakeSupabase(mode);
    installSupabase(fake);
    const { getMemoryFacts } = await loadLane<MemoryStoreModule>("features/memory/supabaseStore");
    const t0 = Date.now();
    const pending = getMemoryFacts("11111111-2222-4333-8444-555555555555");
    await vi.advanceTimersByTimeAsync(1_600);
    await expect(pending).resolves.toEqual([]);
    expect(Date.now() - t0).toBeLessThanOrEqual(1_700);
    expectNoLeak(logs, "", false);
  });
});
