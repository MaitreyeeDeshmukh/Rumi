import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Release safety net: chaos tests against fakes, and tests of the release tools (smoke, bundle scan, rollback drill, CI file).
// Run with `pnpm test:qa`. Kept apart from tests/unit so `pnpm check` stays fast; CI runs it in the `chaos` job.
export default defineConfig({
  test: { include: ["tests/chaos/**/*.test.ts", "tests/qa/**/*.test.ts"], environment: "node", testTimeout: 20_000 },
  // `server-only` is resolved by Next at build time; under vitest it is an empty module.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/unit/helpers/serverOnly.ts", import.meta.url)) } },
});
