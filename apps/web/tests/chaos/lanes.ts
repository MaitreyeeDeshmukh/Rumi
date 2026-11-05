/**
 * The production lanes (db, auth, persona, ai-runtime, observability) are built in parallel and reach this branch only when
 * the orchestrator merges them. Chaos tests that need a lane's module are written now against the frozen interface in
 * 08-production-addendum.md section 3 and run as soon as the file exists. `describeWhen` skips a block whose files are absent
 * and says which lane unblocks it. With RUMI_REQUIRE_LANES=1 (set by CI on main) a missing file FAILS instead of skipping,
 * so a skip can never survive into a release.
 */
import { existsSync } from "node:fs";
import { describe, it } from "vitest";

const SRC = new URL("../../src/", import.meta.url);

export type Lane = "ai-runtime" | "observability" | "auth" | "persona";

/** A module path relative to src, without extension (for example "lib/ai/harness"). */
export const present = (rel: string): boolean => [".ts", ".tsx", "/index.ts"].some((ext) => existsSync(new URL(`${rel}${ext}`, SRC)));

export const requireLanes = (): boolean => process.env.RUMI_REQUIRE_LANES === "1";

/** Module paths (relative to src) that must exist for a block to run. Absent and not required: skipped, naming the lane. */
export function describeWhen(lane: Lane, modules: readonly string[], name: string, body: () => void): void {
  const missing = modules.filter((m) => !present(m));
  if (missing.length === 0) describe(name, body);
  else if (requireLanes()) {
    describe(name, () => {
      it(`lane "${lane}" is merged`, () => {
        throw new Error(`lane "${lane}" has not been merged: missing ${missing.join(", ")}`);
      });
    });
  } else describe.skip(`${name} [waiting for lane ${lane}: ${missing.join(", ")}]`, body);
}
