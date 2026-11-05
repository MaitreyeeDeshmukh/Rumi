import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

// Half the cores (at least 2): with 100+ files, one worker each at the same moment starves the tests that start child
// processes or build big values, and they trip the 5 s default. 30 s is for a loaded machine, not for slow code.
const runner = { testTimeout: 30_000, hookTimeout: 30_000, maxWorkers: Math.max(2, Math.floor(availableParallelism() / 2)) };

// Release safety net: chaos tests against fakes, and tests of the release tools (smoke, bundle scan, rollback drill, CI file).
// Run with `pnpm test:qa`. Kept apart from tests/unit so `pnpm check` stays fast; CI runs it in the `chaos` job.
export default defineConfig({
  test: { include: ["tests/chaos/**/*.test.ts", "tests/qa/**/*.test.ts"], environment: "node", ...runner },
  // `server-only` is resolved by Next at build time; under vitest it is an empty module.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/unit/helpers/serverOnly.ts", import.meta.url)) } },
});
