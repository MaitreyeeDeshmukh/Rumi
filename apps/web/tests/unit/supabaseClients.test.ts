import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


// The first import of the Supabase libraries is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
const URL_ = "https://project.supabase.test";
const PUBLISHABLE = "sb_publishable_test_value";
const SECRET = "sb_secret_test_value_never_in_client";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn().mockReturnValue({ kind: "server" }),
  createBrowserClient: vi.fn().mockReturnValue({ kind: "browser" }),
  createClient: vi.fn().mockReturnValue({ kind: "admin" }),
  store: { getAll: vi.fn(() => [{ name: "sb-x-auth-token", value: "from-store" }]), set: vi.fn() },
}));
vi.mock("@supabase/ssr", async (importOriginal) => ({ ...(await importOriginal<typeof import("@supabase/ssr")>()), createServerClient: mocks.createServerClient, createBrowserClient: mocks.createBrowserClient }));
vi.mock("@supabase/supabase-js", async (importOriginal) => ({ ...(await importOriginal<typeof import("@supabase/supabase-js")>()), createClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(mocks.store) }));
vi.mock("server-only", () => ({}));

type Cookies = { getAll: () => Array<{ name: string; value: string }>; setAll: (l: Array<{ name: string; value: string; options: object }>, h: Record<string, string>) => void };
const lastCookies = (): Cookies => (mocks.createServerClient.mock.calls.at(-1)?.[2] as { cookies: Cookies }).cookies;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  mocks.createServerClient.mockClear();
  mocks.createBrowserClient.mockClear();
  mocks.createClient.mockClear();
  mocks.store.set.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE);
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("browser client", () => {
  it("uses the publishable key only", async () => {
    const { getBrowserClient } = await import("@/lib/supabase/browser");
    getBrowserClient();
    expect(mocks.createBrowserClient).toHaveBeenCalledWith(URL_, PUBLISHABLE);
    expect(JSON.stringify(mocks.createBrowserClient.mock.calls)).not.toContain(SECRET);
  });

  it("throws a fixed error when Supabase is not configured, and never echoes a value", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not a url");
    const { getBrowserClient } = await import("@/lib/supabase/browser");
    expect(() => getBrowserClient()).toThrowError("supabase_not_configured");
  });
});

describe("server client", () => {
  it("with a request: reads that request's cookies, with the publishable key, and never writes cookies", async () => {
    const { getServerClient } = await import("@/lib/supabase/server");
    await getServerClient(new Request("https://rumi.test/api/x", { headers: { cookie: "sb-p-auth-token=abc; other=1" } }));
    const [url, key] = mocks.createServerClient.mock.calls[0];
    expect([url, key]).toEqual([URL_, PUBLISHABLE]);
    expect(lastCookies().getAll()).toEqual([
      { name: "sb-p-auth-token", value: "abc" },
      { name: "other", value: "1" },
    ]);
    lastCookies().setAll([{ name: "sb-p-auth-token", value: "new", options: {} }], {});
    expect(mocks.store.set).not.toHaveBeenCalled();
  });

  it("without a request: uses the next/headers cookie store, and a store that refuses writes is not an error", async () => {
    const { getServerClient } = await import("@/lib/supabase/server");
    await getServerClient();
    expect(lastCookies().getAll()).toEqual([{ name: "sb-x-auth-token", value: "from-store" }]);
    lastCookies().setAll([{ name: "a", value: "b", options: { path: "/" } }], {});
    expect(mocks.store.set).toHaveBeenCalledWith("a", "b", { path: "/" });
    mocks.store.set.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });
    expect(() => lastCookies().setAll([{ name: "a", value: "b", options: {} }], {})).not.toThrow();
  });

  it("every call carries a deadline", async () => {
    const { getServerClient } = await import("@/lib/supabase/server");
    await getServerClient(new Request("https://rumi.test/x"));
    const options = mocks.createServerClient.mock.calls[0][2] as { global: { fetch: typeof fetch } };
    const seen: Array<AbortSignal | null | undefined> = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((_i: RequestInfo | URL, init?: RequestInit) => (seen.push(init?.signal), Promise.resolve(new Response("{}")))) as typeof fetch;
    try {
      await options.global.fetch("https://x.test");
      const own = new AbortController();
      await options.global.fetch("https://x.test", { signal: own.signal });
    } finally {
      globalThis.fetch = original;
    }
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[1]).not.toBe(seen[0]);
  });

  it("page-request calls have a 3 s deadline", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const { getServerClient } = await import("@/lib/supabase/server");
    await getServerClient(new Request("https://rumi.test/x"));
    const options = mocks.createServerClient.mock.calls[0][2] as { global: { fetch: typeof fetch } };
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response("{}"))) as typeof fetch;
    try {
      await options.global.fetch("https://x.test");
    } finally {
      globalThis.fetch = original;
    }
    expect(spy).toHaveBeenCalledWith(3000);
    spy.mockRestore();
  });

  it("not configured: a config AppError, with no client built", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const { getServerClient } = await import("@/lib/supabase/server");
    await expect(getServerClient(new Request("https://rumi.test/x"))).rejects.toMatchObject({ code: "config" });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});

describe("admin client", () => {
  it("uses the secret key, keeps no session, and is built once", async () => {
    const { getAdminClient } = await import("@/lib/supabase/admin");
    const a = getAdminClient();
    expect(getAdminClient()).toBe(a);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = mocks.createClient.mock.calls[0] as [string, string, { auth: object }];
    expect([url, key]).toEqual([URL_, SECRET]);
    expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
  });

  it("admin calls get a longer deadline (10 s), so a slow delete is not cut short", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const { getAdminClient } = await import("@/lib/supabase/admin");
    getAdminClient();
    const options = mocks.createClient.mock.calls[0][2] as { global: { fetch: typeof fetch } };
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response("{}"))) as typeof fetch;
    try {
      await options.global.fetch("https://x.test");
    } finally {
      globalThis.fetch = original;
    }
    expect(spy).toHaveBeenCalledWith(10_000);
    spy.mockRestore();
  });

  it("without the secret key it is a config error and nothing is built", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const { getAdminClient } = await import("@/lib/supabase/admin");
    expect(() => getAdminClient()).toThrowError(expect.objectContaining({ code: "config" }));
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
