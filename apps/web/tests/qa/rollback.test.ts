import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, runNode, serve } from "./run";

const SCRIPT = `${REPO_ROOT}scripts/rollback-drill.mjs`;
const TOKEN = "vercel_test_token_do_not_print_123";
const deployment = (uid: string, host: string, created: number) => ({ uid, url: host, created, state: "READY", target: "production" });

describe("scripts/rollback-drill.mjs", () => {
  it("prints the rollback command for the PREVIOUS production deployment, and nothing else is run", async () => {
    const s = await serve(() => ({
      body: { deployments: [deployment("dpl_new", "rumi-new.vercel.app", 1_800_000_200_000), deployment("dpl_old", "rumi-old.vercel.app", 1_800_000_100_000)] },
    }));
    try {
      const r = await runNode(SCRIPT, [], { VERCEL_TOKEN: TOKEN, VERCEL_PROJECT_ID: "prj_1", VERCEL_API_URL: s.url });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("vercel rollback rumi-old.vercel.app");
      expect(r.stdout).not.toContain("vercel rollback rumi-new.vercel.app");
      expect(r.stdout).toMatch(/current\s+dpl_new/);
      // The request asks for READY production deployments of that project only, with the token in a header.
      expect(s.requests).toHaveLength(1);
      expect(s.requests[0]).toMatch(/^GET \/v6\/deployments\?/);
      expect(s.requests[0]).toContain("projectId=prj_1");
      expect(s.requests[0]).toContain("target=production");
      expect(s.requests[0]).toContain("state=READY");
      expect(s.requests[0]).not.toContain(TOKEN);
    } finally {
      await s.close();
    }
  });

  it("adds the team scope when a team id is set", async () => {
    const s = await serve(() => ({ body: { deployments: [deployment("a", "a.vercel.app", 2), deployment("b", "b.vercel.app", 1)] } }));
    try {
      const r = await runNode(SCRIPT, [], { VERCEL_TOKEN: TOKEN, VERCEL_PROJECT_ID: "p", VERCEL_TEAM_ID: "team_9", VERCEL_API_URL: s.url });
      expect(r.stdout).toContain("vercel rollback b.vercel.app --scope team_9");
      expect(s.requests[0]).toContain("teamId=team_9");
    } finally {
      await s.close();
    }
  });

  it("never prints the token", async () => {
    const s = await serve(() => ({ status: 401, body: { error: "bad" } }));
    try {
      const r = await runNode(SCRIPT, [], { VERCEL_TOKEN: TOKEN, VERCEL_PROJECT_ID: "p", VERCEL_API_URL: s.url });
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(TOKEN);
    } finally {
      await s.close();
    }
  });

  it("with only one deployment there is nothing to roll back to: exit 1, no command printed", async () => {
    const s = await serve(() => ({ body: { deployments: [deployment("only", "only.vercel.app", 1)] } }));
    try {
      const r = await runNode(SCRIPT, [], { VERCEL_TOKEN: TOKEN, VERCEL_PROJECT_ID: "p", VERCEL_API_URL: s.url });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/nothing to roll back to/);
      expect(r.stdout).not.toContain("vercel rollback");
    } finally {
      await s.close();
    }
  });

  it("explains what is missing when the token or project id is not set", async () => {
    const r = await runNode(SCRIPT, [], {});
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/VERCEL_TOKEN/);
  });

  it("cannot run the command: the script has no way to start a process", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).not.toMatch(/child_process|spawn|exec(?:Sync|File)?\(|Deno\.|Bun\./);
  });
});
