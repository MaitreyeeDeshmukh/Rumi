import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(resolve(dir, n)).isDirectory() ? walk(resolve(dir, n)) : [resolve(dir, n)]));
const ALL = walk(SRC).filter((f) => /\.tsx?$/.test(f));
const rel = (f: string): string => f.slice(SRC.length + 1).replace(/\\/g, "/");

function resolveSpec(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]) if (existsSync(c) && statSync(c).isFile() && /\.tsx?$/.test(c)) return c;
  return null;
}

/** Every project file and package reachable from the entries, following static and dynamic imports. */
function reachable(entries: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];
  for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
    if (files.has(f)) continue;
    files.add(f);
    // Type-only imports are erased by the compiler and never reach a bundle.
    const text = readFileSync(f, "utf8").replace(/^\s*(?:import|export)\s+type\s[^;]*;/gm, "");
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const target = resolveSpec(spec, f);
      if (target) queue.push(target);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) packages.add(spec);
    }
  }
  return { files, packages };
}

/** A file is client code when it starts with the "use client" directive. */
const clientEntries = ALL.filter((f) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(readFileSync(f, "utf8")));
const SERVER_FILES = ["lib/supabase/admin.ts", "lib/supabase/server.ts", "lib/env.ts", "lib/auth/requireUser.ts", "lib/auth/secret.ts", "lib/auth/ownerTables.ts", "lib/security/guardRequest.ts"];

describe("the secret key and the admin client never reach the browser", () => {
  it("finds the client entries it should (AuthProvider is one)", () => {
    expect(clientEntries.map(rel)).toContain("features/auth/AuthProvider.tsx");
  });

  it("nothing reachable from a 'use client' file is a server module", () => {
    for (const entry of clientEntries) {
      const files = [...reachable([entry]).files].map(rel);
      expect({ entry: rel(entry), server: files.filter((f) => SERVER_FILES.includes(f)) }).toEqual({ entry: rel(entry), server: [] });
    }
  });

  it("nothing reachable from the browser client or the sign-in controller imports node: modules, server-only, next/headers or the Supabase admin or server code", () => {
    const entries = ["lib/supabase/browser.ts", "features/auth/authController.ts", "features/auth/mapError.ts", "features/auth/AuthProvider.tsx"].map((e) => resolve(SRC, e));
    const { files, packages } = reachable(entries);
    expect([...packages].filter((p) => p.startsWith("node:") || p === "server-only" || p === "next/headers" || p === "next/server").sort()).toEqual([]);
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/SUPABASE_SECRET_KEY|service_role|secret_key/i);
  });

  it("the secret key is named in exactly one source file, and that file starts with server-only", () => {
    const named = ALL.filter((f) => readFileSync(f, "utf8").includes("SUPABASE_SECRET_KEY")).map(rel);
    expect(named).toEqual(["lib/supabase/admin.ts"]);
    expect(readFileSync(resolve(SRC, "lib/supabase/admin.ts"), "utf8").split("\n").find((l) => l.trim() !== "" && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith(" *"))).toBe('import "server-only";');
  });

  it("only route handlers and server libraries import the admin client", () => {
    const importers = ALL.filter((f) => /["']@\/lib\/supabase\/admin["']|["']\.\/admin["']/.test(readFileSync(f, "utf8"))).map(rel);
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) expect({ f, ok: /^app\/api\/.+\/route\.ts$/.test(f) || /^lib\/(?!supabase\/browser)/.test(f) }).toEqual({ f, ok: true });
    for (const c of clientEntries) expect(importers).not.toContain(rel(c));
  });

  it("no NEXT_PUBLIC variable carries a secret", () => {
    for (const f of ALL) expect({ f: rel(f), hit: /NEXT_PUBLIC_[A-Z_]*(?:SECRET|SERVICE|PRIVATE)/.test(readFileSync(f, "utf8")) }).toEqual({ f: rel(f), hit: false });
  });
});
