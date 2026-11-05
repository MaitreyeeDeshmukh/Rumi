import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

// Half the cores (at least 2): with 100+ files, one worker each at the same moment starves the tests that start child
// processes or build big values, and they trip the 5 s default. 30 s is for a loaded machine, not for slow code.
const runner = { testTimeout: 30_000, hookTimeout: 30_000, maxWorkers: Math.max(2, Math.floor(availableParallelism() / 2)) };


// `pnpm check` runs only tests/unit. Other suites (for example the gitignored tests/roast folder) are run with their own
// config, which copies this file and changes `include`: pnpm vitest run --config <that file>.
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node", ...runner },
  // `server-only` is resolved by Next at build time; under vitest it is an empty module.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/unit/helpers/serverOnly.ts", import.meta.url)) } },
});
