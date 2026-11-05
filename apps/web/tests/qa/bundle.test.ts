import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNode, WEB_ROOT } from "./run";

const SCRIPT = `${WEB_ROOT}scripts/check-bundle.mjs`;
const b64url = (o: object): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string): string => `eyJhbGciOiJIUzI1NiJ9.${b64url({ iss: "supabase", role })}.c2lnbmF0dXJlLXBhcnQtMTIzNDU2`;

let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

/** A fake build: `.next/static/chunks/app.js` holding `js`, plus an optional `public/` file. */
function build(js: string, pub?: string): string {
  dir = mkdtempSync(join(tmpdir(), "rumi-bundle-"));
  mkdirSync(join(dir, ".next/static/chunks"), { recursive: true });
  writeFileSync(join(dir, ".next/static/chunks/app.js"), js);
  if (pub !== undefined) {
    mkdirSync(join(dir, "public"));
    writeFileSync(join(dir, "public/index.html"), pub);
  }
  return dir;
}
/** With no dirs given the script uses its defaults (.next/static and public). */
const scan = (root: string, ...dirs: string[]) => runNode(SCRIPT, dirs, {}, root);

describe("scripts/check-bundle.mjs", () => {
  it("passes a clean bundle that holds only public values (anon JWT, publishable key, URL)", async () => {
    const r = await scan(build(`var a="${jwt("anon")}",b="sb_publishable_abcdefghij",c="https://x.supabase.co";`, "<p>hello</p>"));
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/2 files scanned/);
  });

  it.each([
    ["SUPABASE_SECRET_KEY", 'process.env.SUPABASE_SECRET_KEY'],
    ["SUPABASE_SERVICE_ROLE_KEY", 'x="SUPABASE_SERVICE_ROLE_KEY"'],
    ["service_role", 'role:"service_role"'],
    ["GROQ_API_KEY", 'k="GROQ_API_KEY"'],
    ["SESSION_SECRET", 'k="SESSION_SECRET"'],
    ["getAdminClient", "function(){return getAdminClient()}"],
    ["supabase/admin", 'import("@/lib/supabase/admin")'],
    ["groq_key", 'k="gsk_abcdefghijklmnopqrstuvwx"'],
    ["supabase_secret_key", 'k="sb_secret_abcdefghijklmnop"'],
    ["admin_api_call", "c.auth.admin.deleteUser(id)"],
  ])("fails when the bundle contains %s", async (rule, js) => {
    const r = await scan(build(`var ok=1;${js};`));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(rule);
  });

  it("fails on a real service-role JWT even though its text has no forbidden word", async () => {
    const token = jwt("service_role");
    const r = await scan(build(`var k="${token}";`));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("service_role JWT");
    expect(r.stderr).not.toContain(token);
  });

  it("scans public/ as well, and every nested file", async () => {
    const r = await scan(build("var ok=1", "<script>k='gsk_abcdefghijklmnopqrstuvwx'</script>"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("public");
  });

  it("never prints the matched secret", async () => {
    const secret = "gsk_ABCDEFGHIJKLMNOPQRSTUVWX";
    const r = await scan(build(`k="${secret}"`));
    expect(r.code).toBe(1);
    expect(r.stderr + r.stdout).not.toContain(secret);
  });

  it("a missing build output is a failure, not a pass", async () => {
    dir = mkdtempSync(join(tmpdir(), "rumi-bundle-"));
    expect((await scan(dir)).code).toBe(2);
  });

  it("an empty build output is a failure, not a pass", async () => {
    dir = mkdtempSync(join(tmpdir(), "rumi-bundle-"));
    mkdirSync(join(dir, ".next/static"), { recursive: true });
    expect((await scan(dir)).code).toBe(2);
  });
});
