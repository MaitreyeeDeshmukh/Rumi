import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";


// The first import of the Supabase libraries is slow on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
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
    return { auth: { getClaims: mocks.getClaims, getUser: mocks.getUser, getSession: mocks.getSession } };
  },
}));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: mocks.warn }) }));

import { config, proxy } from "@/proxy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const call = (path: string, headers: Record<string, string> = {}): NextRequest => new NextRequest(`https://rumi.test${path}`, { headers });
const withSession = { cookie: "sb-project-auth-token=abc" };

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "u" } }, error: null });
  mocks.getUser.mockReset();
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
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("with a session cookie it checks the token locally with getClaims, never getUser (a network call) or getSession", async () => {
    await proxy(call("/help", withSession));
    expect(mocks.getClaims).toHaveBeenCalledTimes(1);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("forwards refreshed cookies to the route and to the browser, with no-cache headers, and keeps the request id", async () => {
    mocks.getClaims.mockImplementation(() => {
      mocks.setAll?.([{ name: "sb-project-auth-token", value: "fresh", options: { path: "/", httpOnly: true } }], { "Cache-Control": "private, no-cache, no-store, must-revalidate" });
      return Promise.resolve({ data: { claims: { sub: "u" } }, error: null });
    });
    const res = await proxy(call("/help", withSession));
    expect(res.cookies.get("sb-project-auth-token")?.value).toBe("fresh");
    expect(res.headers.get("x-middleware-request-cookie")).toContain("sb-project-auth-token=fresh");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });

  it("an unreachable Auth server still serves the page and leaves one warning with no error text", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthRetryableFetchError("secret socket detail", 0) });
    expect((await proxy(call("/help", withSession))).status).toBe(200);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith("session_refresh_failed");
  });

  it("a thrown fault is also served and logged", async () => {
    mocks.getClaims.mockRejectedValue(new Error("boom"));
    expect((await proxy(call("/help", withSession))).status).toBe(200);
    expect(mocks.warn).toHaveBeenCalledWith("session_refresh_failed");
  });

  it("a rejected token (the visitor's state, not a fault) is not logged", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthApiError("JWT expired", 401, "bad_jwt") });
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

describe("proxy kill switch and rate limits", () => {
  it("AUTH_PROXY_REFRESH=off skips Supabase Auth entirely but still sets the request id", async () => {
    vi.stubEnv("AUTH_PROXY_REFRESH", "off");
    const res = await proxy(call("/help", withSession));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toMatch(UUID);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getClaims).not.toHaveBeenCalled();
    vi.stubEnv("AUTH_PROXY_REFRESH", "OFF ");
    await proxy(call("/help", withSession));
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("any other value leaves the refresh on", async () => {
    for (const v of ["", "on", "false", "0"]) {
      vi.stubEnv("AUTH_PROXY_REFRESH", v);
      mocks.getClaims.mockClear();
      await proxy(call("/help", withSession));
      expect(mocks.getClaims).toHaveBeenCalledTimes(1);
    }
  });

  it("a 429 from Auth is logged as auth_rate_limited (code only), at most once a minute, and the page is still served", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthApiError("secret provider text", 429, "over_request_rate_limit") });
    expect((await proxy(call("/a", withSession))).status).toBe(200);
    expect((await proxy(call("/b", withSession))).status).toBe(200);
    expect(mocks.warn.mock.calls).toEqual([["auth_rate_limited", { code: "rate_limited" }]]);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("secret");
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
