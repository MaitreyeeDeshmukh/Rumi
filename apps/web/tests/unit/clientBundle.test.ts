import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** Server-side modules: they hold the Supermemory key, the tag secret or node-only code. */
const SERVER_ONLY = ["features/memory/smClient", "features/memory/remoteSync", "features/memory/forgetAll", "features/memory/tag"];
/** Entry points that ship to the browser. */
// Add features/memory/useMemoryControls.ts here when Phase 2 creates it: it runs in the browser too.
const CLIENT_ENTRIES = ["features/state/RumiProvider.tsx", "lib/api/client.ts", "features/memory/actions.ts", "features/share/buildShareText.ts", "features/support/card.ts"];

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
    expect(rel).toEqual(expect.arrayContaining(["features/state/stateStore.ts", "lib/storage.ts", "features/memory/persona.ts", "features/memory/recoveryCode.ts"]));
  });

  it("no module reachable from RumiProvider, callApi, the memory actions or the builders is a server module", () => {
    for (const server of SERVER_ONLY) expect(rel.some((f) => f.startsWith(server))).toBe(false);
  });

  it("nothing reachable imports a node: module", () => {
    expect([...packages].filter((p) => p.startsWith("node:"))).toEqual([]);
  });

  it("the walker itself sees a server import when there is one", () => {
    const withServer = reachable(["features/memory/remoteSync.ts"]);
    const names = [...withServer.files].map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/"));
    expect(names).toContain("features/memory/smClient.ts");
    expect(reachable(["features/memory/tag.ts"]).packages.has("node:crypto")).toBe(true);
  });

  it("the walker follows .js and .mjs specifiers to the TypeScript source", () => {
    const virtual = resolve(SRC, "features/memory/virtualEntry.ts");
    for (const ext of [".js", ".mjs", ""]) {
      const seen = reachable(["features/memory/virtualEntry.ts"], (f) => (f === virtual ? 'import { createSmClient } from "./smClient' + ext + '";' : readFileSync(f, "utf8")));
      expect([...seen.files].some((f) => f.endsWith("smClient.ts")), 'extension "' + ext + '"').toBe(true);
    }
    const aliased = reachable(["features/memory/virtualEntry.ts"], (f) => (f === virtual ? 'export * from "@/features/memory/forgetAll.js";' : readFileSync(f, "utf8")));
    expect([...aliased.files].some((f) => f.endsWith("forgetAll.ts"))).toBe(true);
  });

  it("server modules do not claim to be guarded by an import that is not there", () => {
    for (const server of SERVER_ONLY) {
      const text = readFileSync(resolve(SRC, `${server}.ts`), "utf8");
      expect(text).not.toMatch(/server-only/);
      expect(text).not.toMatch(/SERVER ONLY/);
    }
  });
});
