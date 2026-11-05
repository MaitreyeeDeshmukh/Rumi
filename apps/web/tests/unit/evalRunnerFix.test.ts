import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PlanModelOut, PracticeModelOut, RecapModelOut, SayItModelOut } from "../../src/features/shared/schemas";
import { PINNED, type ParitySpec } from "../evals/baseline";
import { buildCases } from "../evals/cases";
import { exitCodeFor } from "../evals/cli.mjs";
import { loadAll } from "../evals/data/schema";
import { makeDryRun } from "../evals/dry";
import { commonSummaries, createSession, ipFor, liveGuard, loadLiveRun, type LiveAdapterModule, type RunFn, type RunRecord } from "../evals/runner";
import { aggregate } from "../evals/scorers/aggregate";
import { DEFAULT_CANARY } from "../evals/scorers/leak";
import { drawSample, type Rating } from "../evals/scorers/humanSample";
import { renderHumanRead } from "../evals/scorers/report";
import type { EvalCase, Observation, TaskName } from "../evals/types";

const data = loadAll();
const cases = buildCases(data, "harness");
const byId = (id: string): EvalCase => cases.find((c) => c.id === id) as EvalCase;
const root = path.resolve(__dirname, "../..");
const cli = (...args: string[]) => spawnSync(process.execPath, ["tests/evals/cli.mjs", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, MOCK_AI: process.env.MOCK_AI ?? "" } });
const okObs = (body: unknown, over: Partial<Observation> = {}): Observation => ({ status: 200, degraded: false, attempts: 1, modelUsed: "m", mode: "live", body, ...over });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("E-16: a timed-out case aborts cleanly and cannot change the session later", () => {
  it("SEEDED BAD: a request that outlives its deadline is recorded as one error and its late answer is ignored", async () => {
    let finished = 0;
    const run: RunFn = async () => {
      await sleep(120);
      finished++;
      return makeDryRun()(byId("plan:p01"));
    };
    const s = createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY, timeoutMs: 30 });
    const r = await s.runOne(byId("plan:p01"), 0);
    expect(r?.cls).toBe("error");
    expect(r?.requests).toBe(1);
    await sleep(250);
    expect(finished).toBe(1);
    expect(s.results).toHaveLength(1);
    expect(s.pool).toHaveLength(0);
  });
  it("a scripted probe stops asking the model once its deadline has passed", async () => {
    let calls = 0;
    const run: RunFn = async () => {
      calls++;
      await sleep(40);
      return okObs({ clinicianSay: `reply ${calls}`, coveredItemIds: [], isLastTurn: false });
    };
    const s = createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY, timeoutMs: 15 });
    const r = await s.runOne(byId("practice:pb01"), 0);
    expect(r?.cls).toBe("error");
    await sleep(300);
    expect(calls).toBeLessThanOrEqual(2);
    expect(s.results).toHaveLength(1);
  });
  it("the probe gets one deadline per step: a slow but in-time probe is not cut off", async () => {
    const run: RunFn = async (c) => {
      await sleep(10);
      return makeDryRun()(c);
    };
    const s = createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY, timeoutMs: 100 });
    const r = await s.runOne(byId("practice:pb01"), 0);
    expect(r?.requests).toBe(4);
    expect(r?.cls).not.toBe("error");
  });
});

describe("runner guards", () => {
  it("P3: the two arms use different address ranges and stay unique inside each", () => {
    expect(ipFor(5, "harness")).toBe("10.77.0.5");
    expect(ipFor(5, "baseline")).toBe("10.78.0.5");
    const seen = new Set<string>();
    for (const arm of ["harness", "baseline"] as const) for (let i = 0; i < 3000; i++) seen.add(ipFor(i, arm));
    expect(seen.size).toBe(6000);
  });
  it("SEEDED BAD: a live session refuses a replayed (dry) observation, but lets mock through to be classed as mock", async () => {
    const live = createSession({ run: async () => okObs({ script: "hi", blanks: [] }, { mode: "dry" }), arm: "harness", k: 1, canary: DEFAULT_CANARY, mode: "live" });
    expect((await live.runOne(byId("sayit:s02"), 0))?.cls).toBe("error");
    const mock = createSession({ run: async () => okObs({ script: "hi", blanks: [] }, { mode: "mock" }), arm: "harness", k: 1, canary: DEFAULT_CANARY, mode: "live" });
    expect((await mock.runOne(byId("sayit:s02"), 0))?.cls).toBe("mock");
  });
  it("E-5 rt17: a different 'previous user' request carrying the marker is sent first, from another address", async () => {
    const seen: { ip: string; text: string; task: string }[] = [];
    const run: RunFn = async (c) => {
      seen.push({ ip: c.ip as string, text: JSON.stringify(c.body), task: c.task });
      return makeDryRun()(c);
    };
    await createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY }).runOne(byId("redteam:rt17"), 0);
    expect(seen).toHaveLength(2);
    expect(seen[0].text).toContain("ZEBRA-QUARTZ-5d2e");
    expect(seen[0].task).toBe("plan");
    expect(seen[1].text).not.toContain("ZEBRA-QUARTZ-5d2e");
    expect(seen[0].ip).not.toBe(seen[1].ip);
  });
});

describe("E-12: loadLiveRun checks parity before any call and drives the baseline through baselineCall", () => {
  const MODEL_OUT = { plan: PlanModelOut, practice: PracticeModelOut, sayit: SayItModelOut, recap: RecapModelOut };
  const specs = (): Record<TaskName, ParitySpec> =>
    Object.fromEntries((Object.keys(PINNED) as TaskName[]).map((t) => [t, { ...PINNED[t], jsonSchema: z.toJSONSchema(MODEL_OUT[t]) }])) as Record<TaskName, ParitySpec>;
  const harnessRun: RunFn = async () => okObs({ script: "harness", blanks: [] });

  it("SEEDED BAD: no specs, or drifted specs, stop the run before the adapter is used", async () => {
    let used = false;
    const mod: LiveAdapterModule = { makeLiveRun: () => ((used = true), harnessRun) };
    await expect(loadLiveRun("harness", async () => mod)).rejects.toThrow(/no harness specs were provided/);
    const drift = specs();
    drift.practice = { ...drift.practice, temperature: 0.99 };
    await expect(loadLiveRun("harness", async () => ({ ...mod, harnessSpecs: drift }))).rejects.toThrow(/practice\.temperature/);
    expect(used).toBe(false);
  });
  it("harness arm: returns the adapter's RunFn when parity holds", async () => {
    const run = await loadLiveRun("harness", async () => ({ makeLiveRun: () => harnessRun, harnessSpecs: specs() }));
    expect((await run(byId("sayit:s02"))).body).toEqual({ script: "harness", blanks: [] });
  });
  it("baseline arm: every case goes through baselineCall (one attempt, the pinned one-sentence task, the model-output schema)", async () => {
    const calls: { system: string; maxCalls: number; keys: string[]; user: string }[] = [];
    const run = await loadLiveRun("baseline", async () => ({
      makeLiveRun: () => harnessRun,
      harnessSpecs: specs(),
      callBaseline: async (call) => {
        calls.push({ system: call.system, maxCalls: call.maxCalls, keys: Object.keys((call.jsonSchema as { properties: object }).properties), user: call.user });
        return okObs({ script: "baseline", blanks: [] });
      },
    }));
    await run(byId("sayit:s02"));
    expect(calls[0].system).toBe(PINNED.sayit.taskSentence);
    expect(calls[0].maxCalls).toBe(1);
    expect(calls[0].keys.sort()).toEqual(["blanks", "crisis", "script"]);
    expect(calls[0].user).toContain("scenario");
    await expect(loadLiveRun("baseline", async () => ({ makeLiveRun: () => harnessRun, harnessSpecs: specs() }))).rejects.toThrow(/callBaseline/);
  });
});

describe("E-6: exit codes", () => {
  it("exitCodeFor: INVALID beats FAIL beats PASS; no verdict is a refusal; a failing vitest run never exits 0", () => {
    expect(exitCodeFor(["PASS", "PASS"], 0)).toBe(0);
    expect(exitCodeFor(["PASS", "FAIL"], 1)).toBe(3);
    expect(exitCodeFor(["FAIL", "INVALID"], 1)).toBe(4);
    expect(exitCodeFor(["INVALID"], 0)).toBe(4);
    expect(exitCodeFor([], 1)).toBe(1);
    expect(exitCodeFor([], 0)).toBe(1);
    expect(exitCodeFor(["PASS"], 1)).toBe(1);
  });
  it("end to end: a consistent dry replay exits 0", { timeout: 90_000 }, () => {
    expect(cli("--dry", "--k=1", "--arm=harness").status).toBe(0);
  });
  it("end to end: --dry-fault=seeded exits 3 (FAIL) and --dry-fault=error exits 4 (INVALID)", { timeout: 120_000 }, () => {
    expect(cli("--dry", "--k=1", "--arm=harness", "--dry-fault=seeded").status).toBe(3);
    expect(cli("--dry", "--k=1", "--arm=harness", "--dry-fault=error").status).toBe(4);
  });
  it("end to end: a bad or misspelled flag exits 2 and --dry --release is refused loudly", { timeout: 60_000 }, () => {
    expect(cli("--dyr").status).toBe(2);
    const r = cli("--dry", "--release");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--dry --release is refused/);
  });
  it("end to end: a live run with MOCK_AI set is refused and exits 1, before any request", { timeout: 60_000 }, () => {
    const r = spawnSync(process.execPath, ["tests/evals/cli.mjs", "--k=1", "--arm=harness"], { cwd: root, encoding: "utf8", env: { ...process.env, MOCK_AI: "1" } });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/MOCK_AI is set/);
  });
});

describe("the human-ratings CLI (backlog)", () => {
  const pool = (["plan", "practice", "sayit", "recap"] as const).flatMap((task) =>
    Array.from({ length: 6 }, (_, i) => (["harness", "baseline"] as const).map((arm) => ({ caseId: `${task}:${i}`, task, arm, rep: 0, input: "in", reply: `reply ${arm} ${task} ${i}`, multiTurn: task === "practice" && i === 0 }))).flat(),
  );
  const { sheet, key } = drawSample(pool, 9);
  const rate = (rater: string, bump = 0): Rating[] =>
    sheet.map((s, i) => ({ blindId: s.blindId, rater, scores: { truth: 2, safety: 2, intent: 2, literal: i < bump ? 1 : 2, agency: 2, ...(s.multiTurn ? { continuity: 2 as const } : {}) } }));

  it("prints the rubric table, per-dimension agreement and per-arm means", () => {
    const text = renderHumanRead(sheet, key, [...rate("ana"), ...rate("ben", 5)], {}).join("\n");
    expect(text).toMatch(/Human read: 20 items, raters ana and ben/);
    expect(text).toMatch(/literal\s+n=20 exact 75\.0%/);
    expect(text).toMatch(/per arm \(unblinded now\): harness n=\d+ pass/);
    expect(text).toMatch(/b01/);
  });
  it("SEEDED BAD: missing scores, a third rater, or a builder scoring their own lane stop the read", () => {
    const partial = [...rate("ana"), ...rate("ben")];
    delete partial[0].scores.truth;
    expect(() => renderHumanRead(sheet, key, partial, {})).toThrow(/truth is missing/);
    expect(() => renderHumanRead(sheet, key, [...rate("ana"), ...rate("ben"), ...rate("cy")], {})).toThrow(/exactly two raters/);
    expect(() => renderHumanRead(sheet, key, [...rate("ana"), ...rate("ben")], { ana: ["plan", "practice", "sayit", "recap"] })).toThrow(/own lane/);
  });
  it("end to end: pnpm eval --human-* prints the table from three JSON files and exits 0; a bad file exits non-zero", { timeout: 90_000 }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rumi-human-"));
    const f = (name: string, v: unknown) => {
      const p = path.join(dir, name);
      writeFileSync(p, JSON.stringify(v));
      return p;
    };
    const ok = cli(`--human-sheet=${f("sheet.json", sheet)}`, `--human-key=${f("key.json", key)}`, `--human-ratings=${f("ratings.json", [...rate("ana"), ...rate("ben", 3)])}`, `--human-lanes=${f("lanes.json", {})}`);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/Human read: 20 items/);
    const bad = cli(`--human-sheet=${f("sheet.json", sheet)}`, `--human-key=${f("key.json", key)}`, `--human-ratings=${f("bad.json", rate("ana"))}`, `--human-lanes=${f("lanes.json", {})}`);
    const noLanes = cli(`--human-sheet=${f("sheet.json", sheet)}`, `--human-key=${f("key.json", key)}`, `--human-ratings=${f("ratings.json", [...rate("ana"), ...rate("ben")])}`);
    expect(noLanes.status).toBe(2);
    expect(noLanes.stderr).toMatch(/--human-lanes/);
    expect(bad.status).not.toBe(0);
    expect(cli("--human-sheet=x").status).toBe(2);
  });
});

describe("the baseline arm in a dry run (E-13, E-11)", () => {
  it("replays one attempt per case, never a fallback, and is a valid, comparable run", async () => {
    const s = createSession({ run: makeDryRun(undefined, "baseline"), arm: "baseline", k: 1, canary: DEFAULT_CANARY });
    for (const c of buildCases(data, "baseline")) await s.runOne(c, 0);
    expect(s.results.every((r) => r.cls === "model_ok" && r.attempts === r.requests)).toBe(true);
    const { aggregate } = await import("../evals/scorers/aggregate");
    const sum = aggregate(s.results, { arm: "baseline" });
    expect(sum.valid).toBe(true);
    expect(sum.notApplicable.length).toBeGreaterThan(0);
  });
});

describe("round 3: exit codes, guards, head to head, pool", () => {
  it("E2-7: COMPARISON (a valid baseline that missed gates) does not fail the run; an arm that never started is misuse (1), even when the other arm FAILs", () => {
    expect(exitCodeFor(["PASS", "COMPARISON"], 0, 2)).toBe(0);
    expect(exitCodeFor(["FAIL", "COMPARISON"], 1, 2)).toBe(3);
    expect(exitCodeFor(["FAIL"], 1, 2)).toBe(1);
    expect(exitCodeFor(["INVALID"], 1, 2)).toBe(1);
    expect(exitCodeFor(["PASS"], 0, 1)).toBe(0);
    expect(exitCodeFor(["PASS", "INVALID"], 1, 2)).toBe(4);
  });
  it("end to end: the default pnpm eval --dry (both arms) exits 0 even though the baseline is graded on harness-only rules", { timeout: 90_000 }, () => {
    const r = cli("--dry", "--k=1");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/role: yardstick only/);
    expect(r.stdout).toMatch(/replay only: scorers are proven by pnpm check and --self-test/);
  });
  it("E2-10 end to end: --self-test exits 0 and prints the count; it refuses to combine with other flags", { timeout: 60_000 }, () => {
    const ok = cli("--self-test");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/self-test: \d+ seeded items checked, 0 scorer problem/);
    expect(cli("--self-test", "--dry").status).toBe(2);
  });
  it("P3: a whitespace-only GROQ_API_KEY is refused", () => {
    expect(liveGuard({ GROQ_API_KEY: "   ", NODE_ENV: "test" }).join(" ")).toMatch(/GROQ_API_KEY/);
    expect(liveGuard({ GROQ_API_KEY: "\t\n", NODE_ENV: "test" }).join(" ")).toMatch(/GROQ_API_KEY/);
    expect(liveGuard({ GROQ_API_KEY: " k ", NODE_ENV: "test" })).toEqual([]);
  });
  const recordFor = async (arm: "harness" | "baseline"): Promise<RunRecord> => {
    const s = createSession({ run: makeDryRun(undefined, arm), arm, k: 1, canary: DEFAULT_CANARY });
    for (const c of buildCases(data, arm)) await s.runOne(c, 0);
    return { date: "d", commit: "c", mode: "dry", arm, k: 1, summary: aggregate(s.results, { arm }), results: s.results };
  };
  it("E2-12: commonSummaries scores each arm on the cases both ran: no crisis suite, no harness-only rows", async () => {
    const [h, b] = [await recordFor("harness"), await recordFor("baseline")];
    const common = commonSummaries([h, b]);
    expect(common.get("harness")?.total).toBe(common.get("baseline")?.total);
    expect(common.get("harness")?.total).toBe(b.results.length);
    expect(h.results.length).toBeGreaterThan(b.results.length);
    expect(common.get("harness")?.crisis.recall.n).toBe(0);
    expect(commonSummaries([h]).size).toBe(0);
  });
  it("E2-11: fallback replies never enter the human pool", async () => {
    let n = 0;
    const run: RunFn = async (c) => {
      const o = await makeDryRun()(c);
      n++;
      return n % 2 === 0 ? { ...o, degraded: true, attempts: 3 } : o;
    };
    const s = createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY });
    for (const c of cases.filter((x) => x.suite === "plan")) await s.runOne(c, 0);
    expect(s.results.some((r) => r.cls === "fallback")).toBe(true);
    const fallbacks = new Set(s.results.filter((r) => r.cls === "fallback").map((r) => r.caseId));
    expect(s.pool.length).toBeGreaterThan(0);
    expect(s.pool.some((p) => fallbacks.has(p.caseId))).toBe(false);
  });
});

describe("round-3 mutants: models and report", () => {
  it("the allow-list of model ids reaches the scorer through the session", async () => {
    const run: RunFn = async () => okObs({ script: "My wrist hurts [how long].", blanks: ["how long"] }, { modelUsed: "rules-v1" });
    const bad = createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY, models: ["openai/gpt-oss-20b"] });
    expect((await bad.runOne(byId("sayit:s02"), 0))?.cls).toBe("error");
    const open = createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY });
    expect((await open.runOne(byId("sayit:s02"), 0))?.cls).toBe("model_ok"); // without a list only the name pattern applies
  });
});
