import { describe, expect, it } from "vitest";
import { buildCsp, supabaseOrigin } from "@/lib/security/csp";

const connect = (csp: string): string => csp.split("; ").find((d) => d.startsWith("connect-src ")) ?? "";

describe("buildCsp", () => {
  it("allows the Supabase origin (and only the origin) in connect-src", () => {
    const csp = buildCsp({ isDev: false, supabaseUrl: "https://abcd1234.supabase.co/auth/v1?x=1" });
    expect(connect(csp)).toBe("connect-src 'self' https://api.cartesia.ai wss://api.cartesia.ai https://abcd1234.supabase.co");
    expect(csp).not.toContain("wss://abcd1234"); // realtime is not used
  });

  it("adds nothing when the URL is missing, malformed or not https (http only for localhost)", () => {
    const plain = "connect-src 'self' https://api.cartesia.ai wss://api.cartesia.ai";
    for (const url of [undefined, "", "not a url", "http://evil.example", "javascript:alert(1)", "ftp://x.supabase.co"]) expect(connect(buildCsp({ isDev: false, supabaseUrl: url }))).toBe(plain);
    expect(supabaseOrigin("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
  });

  it("stays as strict as before everywhere else", () => {
    const csp = buildCsp({ isDev: false, supabaseUrl: "https://abcd1234.supabase.co" });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toMatch(/\*/);
    expect(csp).not.toContain("unsafe-eval");
    expect(buildCsp({ isDev: true })).toContain("'unsafe-eval'");
  });
});
