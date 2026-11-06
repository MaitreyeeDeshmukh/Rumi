import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** Server-side modules: they read the service-role key, verify sessions, hold the hashing secret or use node-only code. */
const SERVER_ONLY = [
  "features/memory/server",
  "features/memory/serverDeps",
  "features/memory/supabaseStore",
  "lib/supabase/admin",
  "lib/auth/requireUser",
  "lib/auth/secret",
  "lib/security/guardRequest",
  "lib/security/rateLimit",
  "lib/ai/harness",
  "lib/ai/cache",
];
/** Entry points that ship to the browser. */
const CLIENT_ENTRIES = [
  "features/state/RumiProvider.tsx",
  "lib/api/client.ts",
  "lib/api/calls.ts",
  "features/memory/actions.ts",
  "features/memory/useMemoryControls.ts",
  "features/share/buildShareText.ts",
  "features/support/card.ts",
];

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/** `./smClient.js` and `./smClient.mjs` style specifiers point at the .ts/.tsx source. */
const stripJsExtension = (spec: string): string => spec.replace(/\.m?js$/, "");

function resolveSpecifier(rawSpec: string, from: string): string | null {
  const spec = stripJsExtension(rawSpec);
  const base = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/** Every file and every bare package specifier reachable from the entries. */
function reachable(entries: string[], read: (file: string) => string = (f) => readFileSync(f, "utf8")): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = entries.map((e) => resolve(SRC, e));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const m of read(file).matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const target = resolveSpecifier(spec, file);
      if (target) queue.push(target);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) packages.add(spec);
    }
  }
  return { files, packages };
}

describe("browser bundle stays free of server modules", () => {
  const { files, packages } = reachable(CLIENT_ENTRIES);
  const rel = [...files].map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/"));

  it("the walk really reaches the browser code it should", () => {
    expect(rel).toEqual(expect.arrayContaining(["features/state/stateStore.ts", "lib/storage.ts", "features/memory/persona.ts"]));
  });

  it("no module reachable from RumiProvider, callApi, the memory actions or the builders is a server module", () => {
    for (const server of SERVER_ONLY) expect(rel.some((f) => f.startsWith(server))).toBe(false);
  });

  it("the new browser entries (task calls, memory hook) are walked and reach the browser code they use", () => {
    expect(rel).toEqual(expect.arrayContaining(["lib/api/calls.ts", "features/memory/useMemoryControls.ts", "lib/crisis.ts", "lib/literalLint.ts"]));
  });

  it("no reachable module imports a node: module except lib/errors.ts (fingerprintOf hashes with node:crypto; only server code calls it)", () => {
    const importers = rel.filter((f) => /from\s*["']node:/.test(readFileSync(resolve(SRC, f), "utf8")));
    expect(importers).toEqual(["lib/errors.ts"]);
  });

  it("the walker itself sees a server import when there is one", () => {
    const withServer = reachable(["features/memory/server.ts"]);
    const names = [...withServer.files].map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/"));
    expect(names).toContain("features/memory/supabaseStore.ts");
    expect(reachable(["features/memory/serverDeps.ts"]).packages.has("node:crypto")).toBe(true);
  });

  it("the walker follows .js and .mjs specifiers to the TypeScript source", () => {
    const virtual = resolve(SRC, "features/memory/virtualEntry.ts");
    for (const ext of [".js", ".mjs", ""]) {
      const seen = reachable(["features/memory/virtualEntry.ts"], (f) => (f === virtual ? 'import { createSupabaseStore } from "./supabaseStore' + ext + '";' : readFileSync(f, "utf8")));
      expect([...seen.files].some((f) => f.endsWith("supabaseStore.ts")), 'extension "' + ext + '"').toBe(true);
    }
    const aliased = reachable(["features/memory/virtualEntry.ts"], (f) => (f === virtual ? 'export * from "@/features/memory/serverDeps.js";' : readFileSync(f, "utf8")));
    expect([...aliased.files].some((f) => f.endsWith("serverDeps.ts"))).toBe(true);
  });

  it("the service-role client is guarded by server-only, which fails the Next build if a client module imports it", () => {
    expect(readFileSync(resolve(SRC, "lib/supabase/admin.ts"), "utf8")).toMatch(/^import "server-only";/m);
  });
});
