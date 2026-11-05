/**
 * Guards .github/workflows/ci.yml against being weakened. It reads the file as text (no YAML dependency is installed), so it
 * checks the rules that matter: nothing is optional, every action is pinned, permissions are read-only, and each production
 * safety job still runs the command that makes it a gate.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./run";

const text = readFileSync(`${REPO_ROOT}.github/workflows/ci.yml`, "utf8").replace(/\r\n/g, "\n");

/** Job name -> its block of text. Jobs are the two-space-indented keys under `jobs:`. */
function jobs(): Record<string, string> {
  const body = text.slice(text.indexOf("\njobs:\n") + 6);
  const out: Record<string, string> = {};
  const starts = [...body.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)];
  starts.forEach((m, i) => {
    out[m[1]] = body.slice(m.index, starts[i + 1]?.index ?? body.length);
  });
  return out;
}
const J = jobs();

describe(".github/workflows/ci.yml", () => {
  it("still has every job and gate it had before the production work", () => {
    expect(Object.keys(J)).toEqual(expect.arrayContaining(["repo-hygiene", "prototype", "web"]));
    expect(J["repo-hygiene"]).toContain("bash scripts/check-no-stray-md.sh");
    expect(J["repo-hygiene"]).toMatch(/gitleaks\/gitleaks-action@/);
    expect(J.prototype).toContain("npm run typecheck");
    expect(J.prototype).toContain("git diff --exit-code -- prototype/dist/index.html");
    for (const step of ["pnpm install --frozen-lockfile", "pnpm check", "pnpm build", "pnpm audit --audit-level=high", "pnpm test:e2e"]) {
      expect(J.web, step).toContain(step);
    }
    expect(J.web).toMatch(/needs: prototype/);
  });

  it("has the production safety jobs", () => {
    expect(Object.keys(J)).toEqual(expect.arrayContaining(["sql-tests", "unit-contract", "chaos", "e2e", "bundle-scan", "audit", "gitleaks", "load-smoke"]));
  });

  it("nothing is allowed to fail quietly", () => {
    expect(text).not.toMatch(/continue-on-error/);
    expect(text).not.toMatch(/\|\|\s*(true|:)\s*$/m);
    expect(text).not.toMatch(/^\s*if:\s*(false|\$\{\{\s*false\s*\}\})\s*$/m);
    expect(text).not.toMatch(/--no-verify|--ignore-scripts=false|set \+e/);
  });

  it("every action is pinned to an exact version tag or a full commit SHA", () => {
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(10);
    for (const u of uses) expect(u, u).toMatch(/@(v\d+\.\d+\.\d+|[0-9a-f]{40})$/);
  });

  it("permissions are read-only for the whole workflow and no job asks for more", () => {
    expect(text).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(text).not.toMatch(/^\s+[a-z-]+:\s*write\s*$/m);
    expect(text).not.toMatch(/id-token:|pull-requests:\s*write|contents:\s*write|packages:\s*write/);
  });

  it("every job has a timeout", () => {
    for (const [name, block] of Object.entries(J)) expect(block, name).toMatch(/timeout-minutes:\s*\d+/);
  });

  it("every pnpm job caches the pnpm store", () => {
    for (const [name, block] of Object.entries(J)) {
      if (block.includes("pnpm install")) expect(block, name).toMatch(/cache: pnpm/);
    }
  });

  it("sql-tests starts local Supabase, runs the SQL files, lints and runs advisors, and fails on main without a database folder", () => {
    const j = J["sql-tests"];
    expect(j).toContain("supabase start");
    expect(j).toMatch(/psql .*ON_ERROR_STOP=1/);
    expect(j).toContain("supabase/tests/*.sql");
    expect(j).toMatch(/supabase db lint .*--fail-on error/);
    expect(j).toMatch(/supabase db advisors .*--fail-on error/);
    expect(j).toMatch(/refs\/heads\/main.*\n.*\n\s*exit 1/);
  });

  it("chaos runs the qa suite and refuses skipped lanes on main", () => {
    expect(J.chaos).toContain("pnpm test:qa");
    expect(J.chaos).toMatch(/RUMI_REQUIRE_LANES: \$\{\{ github\.ref == 'refs\/heads\/main' && '1' \|\| '0' \}\}/);
  });

  it("unit-contract runs the contract and bundle-import tests", () => {
    expect(J["unit-contract"]).toMatch(/vitest run .*contract\.test\.ts.*clientBundle\.test\.ts/);
  });

  it("e2e builds, mocks the AI and runs the anonymous-flow spec", () => {
    const j = J.e2e;
    expect(j).toMatch(/MOCK_AI: "1"/);
    expect(j).toMatch(/RUMI_E2E_AUTH: "1"/);
    expect(j.indexOf("pnpm build")).toBeGreaterThan(-1);
    expect(j.indexOf("pnpm build")).toBeLessThan(j.indexOf("tests/e2e/auth-flow.spec.ts"));
    expect(j).toContain("playwright test tests/e2e/auth-flow.spec.ts");
  });

  it("bundle-scan scans after the build, and proves the scanner fails on a planted key", () => {
    const j = J["bundle-scan"];
    expect(j.indexOf("pnpm build")).toBeLessThan(j.indexOf("pnpm check:bundle"));
    expect(j).toMatch(/gsk_a{20,}/);
    expect(j).toMatch(/\[ "\$code" = "1" \]/);
  });

  it("audit fails on high severity", () => {
    expect(J.audit).toContain("pnpm audit --audit-level=high");
  });

  it("gitleaks scans the full history", () => {
    expect(J.gitleaks).toContain("fetch-depth: 0");
    expect(J.gitleaks).toMatch(/gitleaks\/gitleaks-action@/);
  });

  it("load-smoke runs k6 against the mocked app with a real session secret", () => {
    const j = J["load-smoke"];
    expect(j).toMatch(/MOCK_AI: "1"/);
    expect(j).toContain("k6 run");
    expect(j).toContain("apps/web/tests/load/smoke.js");
    expect(j).toMatch(/SESSION_SECRET=/);
    expect(j.indexOf("pnpm build")).toBeLessThan(j.indexOf("next start"));
  });

  it("load-smoke starts the server with VERCEL=1, so the per-address limit sees real addresses, and k6 requires mostly 200 answers", () => {
    const j = J["load-smoke"];
    const start = j.slice(j.indexOf("- name: Start the app"), j.indexOf("grafana/setup-k6-action"));
    expect(start).toMatch(/env:\n\s+VERCEL: "1"/);
    expect(start).toContain("next start");
    const k6 = readFileSync(`${REPO_ROOT}apps/web/tests/load/smoke.js`, "utf8");
    expect(k6).toMatch(/served_200_rate: \["rate>0\.5"\]/);
    expect(k6).toMatch(/servedRate\.add\(res\.status === 200\)/);
  });

  it("no secret value is written into the workflow", () => {
    // The one allowed key-shaped string is the all-"a" plant that the bundle-scan control writes on purpose.
    expect(text.replace(/gsk_a{20,}/g, "")).not.toMatch(/gsk_[A-Za-z0-9]{20,}|sb_secret_|service_role|eyJ[A-Za-z0-9_-]{20,}/);
  });
});
