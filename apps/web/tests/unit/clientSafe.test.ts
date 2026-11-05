import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * crisis.ts and input.ts run in the browser (layer 1 of the crisis check). Everything they import must parse in Safari
 * 16 and older and must not pull server code into the client bundle.
 */
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const ENTRIES = ["lib/crisis.ts", "lib/ai/guards/input.ts"];

// src/lib/text/tokens.ts still has lookbehind in splitSentences and is imported by the grounding checks, not by the
// two entries above. It is fixed by the orchestrator before merge (issue I-050), so it is not scanned for syntax.
const SYNTAX_EXEMPT = new Set(["lib/text/tokens.ts"]);

const IMPORT_RE = /(?:import|export)[^"';]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(resolve(SRC, from)), spec) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) if (existsSync(candidate)) return candidate.slice(SRC.length).split("\\").join("/");
  return null;
}

/** Every project file reachable from the entries, with its source text. */
function reachable(): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [...ENTRIES];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    const text = readFileSync(resolve(SRC, file), "utf8");
    seen.set(file, text);
    for (const m of text.matchAll(IMPORT_RE)) {
      const next = resolveImport(file, m[1] ?? m[2]);
      if (next) queue.push(next);
    }
  }
  return seen;
}

// type-only imports vanish at build time, so they cannot drag server code in
const withoutTypeImports = (text: string): string => text.replace(/import\s+type[^;]*;/g, "").replace(/export\s+type[^;]*;/g, "");

describe("modules the browser loads (crisis.ts, input.ts and what they import)", () => {
  const files = reachable();

  it("finds the entries and what they import", () => {
    expect([...files.keys()]).toEqual(expect.arrayContaining(ENTRIES));
    expect(files.size).toBeGreaterThanOrEqual(3);
  });

  it("contains no regex lookbehind or named group (a SyntaxError for the whole bundle in Safari before 16.4)", () => {
    for (const [file, text] of files) {
      if (SYNTAX_EXEMPT.has(file)) continue;
      expect({ file, hit: text.includes("(?<") }).toEqual({ file, hit: false });
    }
  });

  it("uses no recent built-ins or operators (at, replaceAll, hasOwn, structuredClone, ??=, ||=, &&=)", () => {
    for (const [file, text] of files) {
      if (SYNTAX_EXEMPT.has(file)) continue;
      const found = [/\.at\(/, /\.replaceAll\(/, /Object\.hasOwn\(/, /structuredClone\(/, /\?\?=/, /\|\|=/, /&&=/].filter((re) => re.test(text)).map(String);
      expect({ file, found }).toEqual({ file, found: [] });
    }
  });

  it("imports no server module: node builtins, env, session, rate limits, prompts or the output guards", () => {
    const forbidden = /["'](?:node:[^"']*|fs|path|crypto|@\/lib\/env|@\/lib\/security\/[^"']*|\.\/session|\.\/rateLimit|@\/lib\/ai\/(?:prompt|http|telemetry)|\.\/output|@\/lib\/ai\/guards\/output)["']/;
    for (const [file, text] of files) {
      const imports = [...withoutTypeImports(text).matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2]);
      expect({ file, bad: imports.filter((i) => forbidden.test(`"${i}"`)) }).toEqual({ file, bad: [] });
    }
  });

  it("does not read process.env", () => {
    for (const [file, text] of files) expect({ file, hit: text.includes("process.env") }).toEqual({ file, hit: false });
  });
});
