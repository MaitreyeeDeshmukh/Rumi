import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** Memory modules that talk to the database or read the request: server only. */
const SERVER_ONLY = ["features/memory/supabaseStore", "features/memory/server", "features/memory/serverDeps"];
/** Everything that must never be bundled for the browser: the memory server modules and the server-side helpers they use. */
const NEVER_IN_BROWSER = [...SERVER_ONLY, "lib/supabase/server", "lib/supabase/admin", "lib/auth/requireUser", "lib/security/"];
/** Entry points that ship to the browser. */
const CLIENT_ENTRIES = [
  "features/state/RumiProvider.tsx",
  "lib/api/client.ts",
  "features/memory/actions.ts",
  "features/memory/useMemoryControls.ts",
  "features/memory/consentCopy.ts",
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
    expect(rel).toEqual(expect.arrayContaining(["features/state/stateStore.ts", "lib/storage.ts", "features/memory/persona.ts", "features/memory/sanitize.ts"]));
  });

  it("no module reachable from RumiProvider, callApi, the memory actions or the builders is a server module", () => {
    for (const server of NEVER_IN_BROWSER) expect(rel.some((f) => f.startsWith(server))).toBe(false);
  });

  it("nothing reachable imports a node: module", () => {
    expect([...packages].filter((p) => p.startsWith("node:"))).toEqual([]);
  });

  it("the walker itself sees a server import when there is one", () => {
    const names = (entry: string) => [...reachable([entry]).files].map((f) => f.slice(SRC.length + 1).replaceAll("\\", "/"));
    expect(names("features/memory/server.ts")).toContain("features/memory/supabaseStore.ts");
    expect(names("features/memory/supabaseStore.ts")).toContain("lib/supabase/server.ts");
    expect(names("features/memory/serverDeps.ts")).toEqual(expect.arrayContaining(["lib/auth/requireUser.ts", "lib/security/guardRequest.ts"]));
    expect(reachable(["features/memory/serverDeps.ts"]).packages.has("node:crypto")).toBe(true);
  });

  it("the walker follows .js and .mjs specifiers to the TypeScript source", () => {
    const virtual = resolve(SRC, "features/memory/virtualEntry.ts");
    for (const ext of [".js", ".mjs", ""]) {
      const seen = reachable(["features/memory/virtualEntry.ts"], (f) => (f === virtual ? 'import { createSupabaseStore } from "./supabaseStore' + ext + '";' : readFileSync(f, "utf8")));
      expect([...seen.files].some((f) => f.endsWith("supabaseStore.ts")), 'extension "' + ext + '"').toBe(true);
    }
    const aliased = reachable(["features/memory/virtualEntry.ts"], (f) => (f === virtual ? 'export * from "@/features/memory/server.js";' : readFileSync(f, "utf8")));
    expect([...aliased.files].some((f) => f.endsWith("server.ts"))).toBe(true);
  });

  it("server modules do not claim to be guarded by an import that is not there", () => {
    for (const server of SERVER_ONLY) {
      const text = readFileSync(resolve(SRC, `${server}.ts`), "utf8");
      expect(text).not.toMatch(/server-only/);
      expect(text).not.toMatch(/SERVER ONLY/);
    }
  });
});
