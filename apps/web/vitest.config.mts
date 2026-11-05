import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";


// `pnpm check` runs only tests/unit. Other suites (for example the gitignored tests/roast folder) are run with their own
// config, which copies this file and changes `include`: pnpm vitest run --config <that file>.
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
