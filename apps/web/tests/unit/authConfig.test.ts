import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const toml = readFileSync(fileURLToPath(new URL("../../../../supabase/config.toml", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/** The lines of one [section], up to the next section header, without comments. */
const section = (name: string): string[] => {
  const start = toml.indexOf(`\n[${name}]\n`);
  expect(start, `[${name}] exists`).toBeGreaterThanOrEqual(0);
  const rest = toml.slice(start + name.length + 4);
  return rest.slice(0, rest.search(/\n\[/) === -1 ? undefined : rest.search(/\n\[/)).split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
};

describe("supabase/config.toml [auth]", () => {
  const auth = section("auth");
  it("anonymous sign-ins on, refresh-token rotation on, JWT expiry one hour", () => {
    expect(auth).toContain("enable_anonymous_sign_ins = true");
    expect(auth).toContain("enable_refresh_token_rotation = true");
    expect(auth).toContain("jwt_expiry = 3600");
  });

  it("site url and redirect urls are the production site and local development, exactly", () => {
    expect(auth).toContain('site_url = "https://rumi-lovat.vercel.app"');
    expect(auth).toContain('additional_redirect_urls = ["https://rumi-lovat.vercel.app", "http://localhost:3000"]');
  });

  it("email confirmations are on, for the email-link upgrade", () => {
    expect(section("auth.email")).toContain("enable_confirmations = true");
  });

  it("one email per address per minute, so the email-link upgrade cannot be used to flood an inbox", () => {
    expect(section("auth.email")).toContain('max_frequency = "60s"');
  });

  it("the captcha section is Turnstile and its secret comes from the environment, never from the file", () => {
    const captcha = section("auth.captcha");
    expect(captcha).toContain('provider = "turnstile"');
    expect(captcha).toContain('secret = "env(TURNSTILE_SECRET_KEY)"');
    expect(captcha.filter((l) => /^secret\s*=/.test(l) && !/env\(/.test(l))).toEqual([]);
  });

  it("no provider secret is committed anywhere in the file", () => {
    for (const line of toml.split("\n")) if (/^\s*(?:secret|key|password|pass)\s*=\s*"[^"]+"/.test(line)) expect(line).toMatch(/env\(/);
  });
});
