import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../evals");
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "runs" ? [] : sources(p);
    return /\.(ts|mjs)$/.test(e.name) ? [p] : [];
  });
const importsOf = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

describe("D33: the measurement does not share code with the thing it measures", () => {
  const files = sources(root);
  it("scans the eval sources", () => {
    expect(files.length).toBeGreaterThan(20);
  });
  it("nothing under tests/evals uses the @/ alias or reaches into src/lib (crisis, ai/guards, text)", () => {
    for (const f of files) {
      for (const spec of importsOf(f)) {
        expect(spec, `${path.relative(root, f)} imports ${spec}`).not.toMatch(/^@\/|src\/lib\//);
      }
    }
  });
  it("the only files read from src are the frozen contract: constants, schemas, task (never lists.ts)", () => {
    for (const f of files) {
      for (const spec of importsOf(f).filter((s) => s.includes("/src/"))) {
        expect(spec, `${path.relative(root, f)} imports ${spec}`).toMatch(/src\/features\/shared\/(constants|schemas|task)$/);
      }
    }
  });
});
