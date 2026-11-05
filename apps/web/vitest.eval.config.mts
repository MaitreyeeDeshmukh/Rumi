import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Flags (--dry, --arm=, --k=) are handled by tests/evals/cli.mjs, which sets EVAL_* variables before starting vitest.
export default defineConfig({
  test: {
    include: ["tests/evals/**/*.eval.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
