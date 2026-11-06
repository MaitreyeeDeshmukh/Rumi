import { NextRequest } from "next/server";
import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), exchange: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims: mocks.getClaims } }) }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: () => Promise.resolve({ auth: { exchangeCodeForSession: mocks.exchange } }) }));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));

import { GET } from "@/app/auth/callback/route";
import { proxy } from "@/proxy";

const call = (path: string, cookie?: string) => new NextRequest(`https://rumi.test${path}`, { headers: cookie ? { cookie } : {} });
const session = "sb-project-auth-token=abc";
const location = (r: Response) => r.headers.get("location");

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "u", is_anonymous: false } }, error: null });
  mocks.exchange.mockReset();
  vi.stubEnv("NEXT_PUBLIC_AUTH_OPTIONAL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

describe("proxy sign-up gate", () => {
  it("sends a visitor with no session from an app screen to /sign-in with a safe return path", async () => {
    const res = await proxy(call("/settings?tab=1"));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("https://rumi.test/sign-in?next=%2Fsettings%3Ftab%3D1");
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("sends a guest (anonymous) session and a rejected token to /sign-in, and lets an email user in", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u", is_anonymous: true } }, error: null });
    expect(location(await proxy(call("/home", session)))).toContain("/sign-in");
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthApiError("bad jwt", 401, "bad_jwt") });
    expect(location(await proxy(call("/home", session)))).toContain("/sign-in");
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u", is_anonymous: false } }, error: null });
    const ok = await proxy(call("/home", session));
    expect(ok.status).toBe(200);
    expect(location(ok)).toBeNull();
  });

  it("lets a session through when Auth cannot be reached (the API routes still check)", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthApiError("down", 503, "unexpected_failure") });
    expect((await proxy(call("/home", session))).status).toBe(200);
  });

  it.each(["/", "/sign-in", "/auth/callback", "/privacy", "/safety", "/accessibility", "/help"])("%s stays public", async (path) => {
    const res = await proxy(call(path));
    expect(res.status).toBe(200);
  });

  it("escape hatch: with NEXT_PUBLIC_AUTH_OPTIONAL=1 there is no gate", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_OPTIONAL", "1");
    expect((await proxy(call("/settings"))).status).toBe(200);
  });
});

describe("/auth/callback", () => {
  const user = (over: Record<string, unknown> = {}) => ({
    data: { user: { is_anonymous: false, email_confirmed_at: "2026-11-05T10:00:00Z", last_sign_in_at: "2026-11-05T10:00:00Z", ...over } },
    error: null,
  });
  const get = (qs: string, cookie?: string) => GET(new NextRequest(`https://rumi.test/auth/callback${qs}`, { headers: cookie ? { cookie } : {} }));

  it("a new address goes to /welcome, a returning one to /home", async () => {
    mocks.exchange.mockResolvedValue(user());
    expect(location(await get("?code=abc"))).toBe("https://rumi.test/welcome");
    mocks.exchange.mockResolvedValue(user({ last_sign_in_at: "2026-11-09T10:00:00Z" }));
    expect(location(await get("?code=abc"))).toBe("https://rumi.test/home");
  });

  it("goes to the saved return path when it is safe, and ignores one that is not", async () => {
    mocks.exchange.mockResolvedValue(user());
    expect(location(await get("?code=abc", "rumi_next=%2Fkit"))).toBe("https://rumi.test/kit");
    expect(location(await get("?code=abc", "rumi_next=%2F%2Fevil.test"))).toBe("https://rumi.test/welcome");
    expect(location(await get("?code=abc", "rumi_next=%E0%A4%A"))).toBe("https://rumi.test/welcome");
  });

  it("a missing code, an exchange error, a guest and a throw all go back to /sign-in?error=link", async () => {
    expect(location(await get(""))).toBe("https://rumi.test/sign-in?error=link");
    mocks.exchange.mockResolvedValue({ data: { user: null }, error: new AuthApiError("provider text", 400, "bad_code") });
    expect(location(await get("?code=abc"))).toBe("https://rumi.test/sign-in?error=link");
    mocks.exchange.mockResolvedValue(user({ is_anonymous: true }));
    expect(location(await get("?code=abc"))).toBe("https://rumi.test/sign-in?error=link");
    mocks.exchange.mockRejectedValue(new Error("boom"));
    expect(location(await get("?code=abc"))).toBe("https://rumi.test/sign-in?error=link");
  });
});
