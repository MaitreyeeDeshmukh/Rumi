import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAll } from "../evals/data/schema";
import { generateByCase } from "../evals/tools/gen-by-case";

const file = path.resolve(__dirname, "../evals/fixtures/replies/by_case.json");

describe("E2-10: the dry-run replies can be regenerated from the repo", () => {
  const generated = generateByCase(loadAll());
  it("the committed by_case.json equals what tests/evals/tools/gen-by-case.ts produces (UPDATE_BY_CASE=1 rewrites it)", () => {
    if (process.env.UPDATE_BY_CASE === "1") writeFileSync(file, `${JSON.stringify(generated, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(generated);
  });
  it("covers every case that is answered by a model, and none of the crisis-card cases", () => {
    expect(Object.keys(generated)).toEqual(expect.arrayContaining(["plan:p01", "practice:pb01", "sayit:s01", "recap:r05", "scenario:sc13", "redteam:rt19", "crisis:negative:01"]));
    expect(Object.keys(generated).some((k) => k.startsWith("crisis:positive") || k.startsWith("crisis:field"))).toBe(false);
  });
});
