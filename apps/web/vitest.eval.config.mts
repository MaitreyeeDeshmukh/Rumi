import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Flags (--dry, --arm=, --k=) are handled by tests/evals/cli.mjs, which sets EVAL_* variables before starting vitest.
export default defineConfig({
  test: {
    include: ["tests/evals/**/*.eval.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Live cases of one arm run four at a time (tests/evals/live.ts matches telemetry to requests by id, so this is safe).
    maxConcurrency: 4,
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
