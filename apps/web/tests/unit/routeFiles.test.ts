import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pending merge: these route files import the harness, which lives on another branch.
describe.each(["plan", "practice", "sayit", "recap"])("api route %s", (task) => {
  const src = readFileSync(join(__dirname, `../../src/app/api/${task}/route.ts`), "utf8").replace(/\r\n/g, "\n");

  it("is the frozen three-line shape: nodejs runtime, dynamic, maxDuration 30, POST calls runTask with its own spec", () => {
    expect(src).toBe(
      `import { ${task}Spec } from '@/features/${task}/spec';\n` +
        `import { runTask } from '@/lib/ai/harness';\n\n` +
        `export const runtime = 'nodejs';\n` +
        `export const dynamic = 'force-dynamic';\n` +
        `export const maxDuration = 30;\n` +
        `export const POST = (req: Request) => runTask(${task}Spec, req);\n`,
    );
  });
});
