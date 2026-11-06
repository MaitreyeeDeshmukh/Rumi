import { execSync } from "node:child_process";

const env = {
  ...process.env,
  NEXT_PUBLIC_CONTACT_EMAIL: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "team@rumi.test",
  NEXT_PUBLIC_E2E: "1",
  // Port of the `next start` server Playwright launches (playwright.config.ts reads the same variable).
  E2E_PORT: process.env.E2E_PORT || "3100",
};
const args = process.argv.slice(2).map((a) => JSON.stringify(a)).join(" ");

execSync("pnpm build", { stdio: "inherit", env });
console.log(`e2e: server port ${env.E2E_PORT}`);
execSync(`pnpm exec playwright test ${args}`, { stdio: "inherit", env });
