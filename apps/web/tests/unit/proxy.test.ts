import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";


// The first import of the Supabase libraries is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  setAll: undefined as undefined | ((l: Array<{ name: string; value: string; options: object }>, h: Record<string, string>) => void),
  createServerClient: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => {
    mocks.createServerClient(...args);
    mocks.setAll = (args[2] as { cookies: { setAll: typeof mocks.setAll } }).cookies.setAll;
    return { auth: { getUser: mocks.getUser, getSession: mocks.getSession } };
  },
}));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: mocks.warn }) }));

import { config, proxy } from "@/proxy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const call = (path: string, headers: Record<string, string> = {}): NextRequest => new NextRequest(`https://rumi.test${path}`, { headers });
const withSession = { cookie: "sb-project-auth-token=abc" };

beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u" } }, error: null });
  mocks.getSession.mockReset();
  mocks.createServerClient.mockClear();
  mocks.warn.mockReset();
  mocks.setAll = undefined;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

describe("proxy request id", () => {
  it("puts a fresh uuid on the response and forwards it to the route, ignoring one the client sent", async () => {
    const res = await proxy(call("/help", { "x-request-id": "forged-id" }));
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(UUID);
    // NextResponse.next({ request: { headers } }) records the forwarded request headers under this prefix.
    expect(res.headers.get("x-middleware-request-x-request-id")).toBe(id);
    expect(res.headers.get("x-middleware-override-headers")).toContain("x-request-id");
  });

  it("every request gets a different id", async () => {
    const a = (await proxy(call("/a"))).headers.get("x-request-id");
    const b = (await proxy(call("/b"))).headers.get("x-request-id");
    expect(a).not.toBe(b);
  });
});

describe("proxy session refresh", () => {
  it("a visitor with no session cookie costs no Supabase call at all", async () => {
    const res = await proxy(call("/help", { cookie: "theme=dark" }));
    expect(res.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("with a session cookie it verifies with getUser and never getSession", async () => {
    await proxy(call("/help", withSession));
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("forwards refreshed cookies to the route and to the browser, with no-cache headers, and keeps the request id", async () => {
    mocks.getUser.mockImplementation(() => {
      mocks.setAll?.([{ name: "sb-project-auth-token", value: "fresh", options: { path: "/", httpOnly: true } }], { "Cache-Control": "private, no-cache, no-store, must-revalidate" });
      return Promise.resolve({ data: { user: { id: "u" } }, error: null });
    });
    const res = await proxy(call("/help", withSession));
    expect(res.cookies.get("sb-project-auth-token")?.value).toBe("fresh");
    expect(res.headers.get("x-middleware-request-cookie")).toContain("sb-project-auth-token=fresh");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });

  it("an unreachable Auth server still serves the page and leaves one warning with no error text", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("secret socket detail", 0) });
    expect((await proxy(call("/help", withSession))).status).toBe(200);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith("session_refresh_failed");
  });

  it("a thrown fault is also served and logged", async () => {
    mocks.getUser.mockRejectedValue(new Error("boom"));
    expect((await proxy(call("/help", withSession))).status).toBe(200);
    expect(mocks.warn).toHaveBeenCalledWith("session_refresh_failed");
  });

  it("a rejected token (the visitor's state, not a fault) is not logged", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("JWT expired", 401, "bad_jwt") });
    expect((await proxy(call("/help", withSession))).status).toBe(200);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("not configured: the page is served and nothing is called", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await proxy(call("/help", withSession));
    expect(res.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});

describe("proxy matcher", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);
  it("covers pages and API routes", () => {
    for (const p of ["/", "/help", "/privacy", "/api/plan", "/api/account/delete"]) expect({ p, hit: re.test(p) }).toEqual({ p, hit: true });
  });
  it("never runs for static assets", () => {
    for (const p of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/logo.png", "/sounds/chime.mp3", "/fonts/a.woff2", "/robots.txt"]) expect({ p, hit: re.test(p) }).toEqual({ p, hit: false });
  });
});
