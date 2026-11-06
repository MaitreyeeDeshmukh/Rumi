import { NextRequest } from "next/server";
import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });
const mocks = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims: mocks.getClaims } }) }));
vi.mock("@/lib/log", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));

import { proxy } from "@/proxy";

const call = (path: string, cookie?: string) => new NextRequest(`https://rumi.test${path}`, { headers: cookie ? { cookie } : {} });
const session = "sb-project-auth-token=abc";
const location = (r: Response) => r.headers.get("location");

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "u", is_anonymous: false } }, error: null });
  vi.stubEnv("NEXT_PUBLIC_AUTH_OPTIONAL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
});

describe("proxy sign-up gate", () => {
  it("sends a visitor with no session from an app screen to /login with a safe return path", async () => {
    const res = await proxy(call("/settings?tab=1"));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("https://rumi.test/login?next=%2Fsettings%3Ftab%3D1");
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });

  it("sends a guest (anonymous) session and a rejected token to /login, and lets an email user in", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u", is_anonymous: true } }, error: null });
    expect(location(await proxy(call("/home", session)))).toContain("/login?next=");
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthApiError("bad jwt", 401, "bad_jwt") });
    expect(location(await proxy(call("/home", session)))).toContain("/login?next=");
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u", is_anonymous: false } }, error: null });
    const ok = await proxy(call("/home", session));
    expect(ok.status).toBe(200);
    expect(location(ok)).toBeNull();
  });

  it("lets a session through when Auth cannot be reached (the API routes still check)", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new AuthApiError("down", 503, "unexpected_failure") });
    expect((await proxy(call("/home", session))).status).toBe(200);
  });

  it.each(["/", "/login", "/signup", "/forgot-password", "/sign-in", "/privacy", "/safety", "/accessibility", "/help"])("%s stays public", async (path) => {
    const res = await proxy(call(path));
    expect(res.status).toBe(200);
  });

  it("escape hatch: with NEXT_PUBLIC_AUTH_OPTIONAL=1 there is no gate", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUTH_OPTIONAL", "1");
    expect((await proxy(call("/settings"))).status).toBe(200);
  });
});
