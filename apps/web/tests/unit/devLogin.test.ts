import { afterEach, describe, expect, it, vi } from "vitest";

const generateLink = vi.fn(() => Promise.resolve({ data: { properties: { hashed_token: "tok" } }, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ auth: { admin: { generateLink } } }) }));

import { POST } from "@/app/api/dev-login/route";

const call = (email: string) => POST(new Request("http://localhost/api/dev-login", { method: "POST", body: JSON.stringify({ email }) }));

afterEach(() => {
  vi.unstubAllEnvs();
  generateLink.mockClear();
});

describe("developer bypass", () => {
  it("gives a token for the bypass email only", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_BYPASS_EMAIL", "rumi@gmail.com");
    const ok = await call(" Rumi@Gmail.com ");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ tokenHash: "tok" });
    expect((await call("someone@else.com")).status).toBe(404);
  });

  it("is off without the variable and in production builds", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEV_BYPASS_EMAIL", "");
    expect((await call("rumi@gmail.com")).status).toBe(404);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEV_BYPASS_EMAIL", "rumi@gmail.com");
    expect((await call("rumi@gmail.com")).status).toBe(404);
    expect(generateLink).not.toHaveBeenCalled();
  });
});
