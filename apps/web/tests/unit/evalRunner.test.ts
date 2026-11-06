import { mkdtempSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildCases } from "../evals/cases";
import { loadAll } from "../evals/data/schema";
import { dryClassFor, loadFixtures, makeDryRun } from "../evals/dry";
import { argvToEnv, exitCodeFor } from "../evals/cli.mjs";
import { readFlags } from "../evals/flags";
import {
  appendCalibration,
  createSession,
  estimateRun,
  formatEstimate,
  ipFor,
  liveGuard,
  liveSkipReason,
  loadLiveRun,
  loadEnvLocal,
  runFileName,
  writeHumanSample,
  toCountsOnly,
  writeRunFile,
  writeSummaryFile,
  type RunFn,
  type RunRecord,
} from "../evals/runner";
import { aggregate } from "../evals/scorers/aggregate";
import { classify } from "../evals/scorers/classify";
import { DEFAULT_CANARY } from "../evals/scorers/leak";
import { DRY_LABEL, renderReport } from "../evals/scorers/report";
import { CASE_CLASSES, type EvalCase, type Observation } from "../evals/types";

const data = loadAll();
const harnessCases = buildCases(data, "harness");
const tmp = () => mkdtempSync(path.join(tmpdir(), "rumi-eval-"));

async function runAll(run: RunFn, k = 1) {
  const session = createSession({ run, arm: "harness", k, canary: DEFAULT_CANARY });
  for (const c of harnessCases) for (let rep = 0; rep < session.repsFor(c); rep++) await session.runOne(c, rep);
  return session;
}

describe("liveGuard (D32)", () => {
  const ok = { GROQ_API_KEY: "present", NODE_ENV: "test" };
  it("a clean environment may run live", () => {
    expect(liveGuard(ok)).toEqual([]);
  });
  it("SEEDED BAD: MOCK_AI set refuses, whatever its value", () => {
    for (const v of ["1", "true", "0", "anything"]) expect(liveGuard({ ...ok, MOCK_AI: v }).join(" ")).toMatch(/MOCK_AI/);
    expect(liveGuard({ ...ok, MOCK_AI: "" })).toEqual([]);
  });
  it("SEEDED BAD: a missing or empty key refuses", () => {
    expect(liveGuard({ NODE_ENV: "test" }).join(" ")).toMatch(/GROQ_API_KEY/);
    expect(liveGuard({ ...ok, GROQ_API_KEY: "" }).join(" ")).toMatch(/GROQ_API_KEY/);
  });
  it("refuses in production and never prints a value", () => {
    expect(liveGuard({ ...ok, NODE_ENV: "production" }).join(" ")).toMatch(/production/);
    const text = liveGuard({ MOCK_AI: "super-secret-value", GROQ_API_KEY: "" }).join(" ");
    expect(text).not.toContain("super-secret-value");
  });
});

describe("flags", () => {
  it("argv becomes env and EVAL_MODE is always set", () => {
    expect(argvToEnv(["--dry", "--arm=baseline", "--k=2", "--dry-fault=error"])).toEqual({
      EVAL_MODE: "1", EVAL_DRY: "1", EVAL_ARM: "baseline", EVAL_K: "2", EVAL_FAULT: "error",
    });
    expect(argvToEnv([])).toEqual({ EVAL_MODE: "1" });
  });
  it("SEEDED BAD: an unknown or misspelled flag stops the run instead of starting a live one", () => {
    expect(() => argvToEnv(["--dyr"])).toThrow(/Unknown flag --dyr/);
    expect(() => argvToEnv(["--arm", "baseline"])).toThrow(/Unknown flag/);
  });
  it("E2-12: --dry together with --release is refused by readFlags too", () => {
    expect(() => readFlags({ EVAL_DRY: "1", EVAL_RELEASE: "1" })).toThrow(/--dry --release is refused/);
    expect(readFlags({ EVAL_RELEASE: "1" }).release).toBe(true);
  });
  it("readFlags defaults to both arms, k=3, live; rejects nonsense", () => {
    expect(readFlags({})).toEqual({ dry: false, arms: ["harness", "baseline"], k: 3, release: false, fault: undefined });
    expect(readFlags({ EVAL_DRY: "1", EVAL_ARM: "harness", EVAL_K: "1" })).toMatchObject({ dry: true, arms: ["harness"], k: 1 });
    expect(() => readFlags({ EVAL_ARM: "both2" })).toThrow();
    expect(() => readFlags({ EVAL_K: "0" })).toThrow();
    expect(() => readFlags({ EVAL_FAULT: "error" })).toThrow(/--dry/);
    expect(() => readFlags({ EVAL_DRY: "1", EVAL_FAULT: "nope" })).toThrow();
  });
});

describe("session", () => {
  it("gives every call a unique x-real-ip, including each step of the scripted probe", async () => {
    const seen: string[] = [];
    const run = makeDryRun();
    await runAll(async (c) => {
      seen.push(c.ip as string);
      return run(c);
    }, 3);
    expect(seen.length).toBeGreaterThan(harnessCases.length);
    expect(new Set(seen).size).toBe(seen.length);
    expect(ipFor(0)).not.toBe(ipFor(1));
    expect(new Set(Array.from({ length: 5000 }, (_, i) => ipFor(i))).size).toBe(5000);
  });
  it("crisis cases run once; all others run k times", async () => {
    const s = createSession({ run: makeDryRun(), arm: "harness", k: 3, canary: DEFAULT_CANARY });
    const crisis = harnessCases.find((c) => c.suite === "crisis") as EvalCase;
    const plan = harnessCases.find((c) => c.suite === "plan") as EvalCase;
    expect(s.repsFor(crisis)).toBe(1);
    expect(s.repsFor(plan)).toBe(3);
  });
  it("drives the probe from its script: the user's lines are fixed, the clinician lines are the model's own replies", async () => {
    const probe = harnessCases.find((c) => c.script) as EvalCase;
    const bodies: { turns: { role: string; text: string }[] }[] = [];
    let n = 0;
    const run: RunFn = async (c) => {
      bodies.push(c.body as never);
      n++;
      return { status: 200, degraded: false, attempts: 1, modelUsed: "m", mode: "live", body: { clinicianSay: `model reply ${n}`, coveredItemIds: [], isLastTurn: false } };
    };
    const s = createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY });
    const r = await s.runOne(probe, 0);
    expect(r?.requests).toBe(4);
    expect(bodies[0].turns.map((t) => t.role)).toEqual(["clinician", "me"]);
    expect(bodies[1].turns.map((t) => t.text)).toContain("model reply 1");
    expect(bodies[3].turns.filter((t) => t.role === "me").map((t) => t.text)).toEqual(probe.script?.steps.map((x) => x.me));
    expect(bodies[3].turns.filter((t) => t.role === "clinician").map((t) => t.text).slice(1)).toEqual(["model reply 1", "model reply 2", "model reply 3"]);
  });
  it("SEEDED BAD: aborts on the first rate_limited and runs nothing after it", async () => {
    let calls = 0;
    const run: RunFn = async () => {
      calls++;
      if (calls === 3) return { status: 429, degraded: false, attempts: 0, modelUsed: null, mode: "live", body: { error: { code: "rate_limited", message: "x" } } };
      return makeDryRun()(harnessCases[0]);
    };
    const s = createSession({ run, arm: "harness", k: 1, canary: DEFAULT_CANARY });
    const outcomes = [];
    for (const c of harnessCases.slice(0, 10)) outcomes.push(await s.runOne(c, 0));
    expect(calls).toBe(3);
    expect(s.abortedAt).toBe(harnessCases[2].id);
    expect(outcomes.slice(3).every((o) => o === null)).toBe(true);
    expect(s.results[2].cls).toBe("error");
    expect(aggregate(s.results, { aborted: true }).verdict).toBe("INVALID");
  });
  it("a RunFn that throws is recorded as an error and its message is not kept", async () => {
    const s = createSession({ run: async () => { throw new Error("contains user text: my knee"); }, arm: "harness", k: 1, canary: DEFAULT_CANARY });
    const r = await s.runOne(harnessCases[0], 0);
    expect(r?.cls).toBe("error");
    expect(JSON.stringify(r)).not.toContain("my knee");
  });
});

describe("dry adapter", () => {
  it("every fixture file classifies as its own class, for every task", () => {
    const { byClass } = loadFixtures();
    for (const cls of CASE_CLASSES) {
      for (const task of ["plan", "practice", "sayit", "recap"] as const) {
        const rec = byClass[cls][task];
        const obs: Observation = { ...rec, tier: rec.tier ?? null, mode: rec.mode ?? "dry" };
        expect(classify(obs), `${cls}/${task}`).toBe(cls);
      }
    }
  });
  it("replays are deterministic and keep fallback under the 20% validity limit", async () => {
    const a = await runAll(makeDryRun());
    const b = await runAll(makeDryRun());
    expect(a.results.map((r) => r.cls)).toEqual(b.results.map((r) => r.cls));
    const s = aggregate(a.results);
    expect(s.valid).toBe(true);
    expect(s.classCounts.fallback / (s.total - s.classCounts.crisis)).toBeLessThanOrEqual(0.2);
  });
  it("the default dry run produces model_ok, retry_ok, fallback and crisis; faults add error, mock, empty", async () => {
    const seen = new Set((await runAll(makeDryRun())).results.map((r) => r.cls));
    for (const c of ["model_ok", "retry_ok", "fallback", "crisis"] as const) expect(seen.has(c), c).toBe(true);
    for (const fault of ["error", "mock", "empty"] as const) {
      const r = await runAll(makeDryRun(fault));
      expect(r.results.some((x) => x.cls === fault), fault).toBe(true);
      expect(aggregate(r.results).verdict).toBe("INVALID");
    }
  });
  it("crisis positives replay a crisis card and negatives pass through", () => {
    const pos = harnessCases.find((c) => c.crisisSet === "positive") as EvalCase;
    const neg = harnessCases.find((c) => c.crisisSet === "negative") as EvalCase;
    expect(dryClassFor(pos)).toBe("crisis");
    expect(dryClassFor(neg)).toBe("model_ok");
  });
  it("seeded-bad replays make the gates fail, and the report still labels every line", async () => {
    const r = await runAll(makeDryRun("seeded"));
    const s = aggregate(r.results);
    expect(s.failedGates).toEqual(expect.arrayContaining(["leak_canary", "leak_link", "leak_image", "advice_dose", "advice_diagnosis", "advice_treatment", "adviceLeak", "inventedSpecifics", "injectionRow:redteam:rt03", "injectionRow:redteam:rt06", "crisisRecall"]));
    const lines = renderReport([{ arm: "harness", summary: s }], { mode: "dry", k: 1 });
    expect(lines.every((l) => l.includes(DRY_LABEL))).toBe(true);
  });
});

describe("run files", () => {
  const rec = async (mode: "live" | "dry"): Promise<RunRecord> => {
    const results = (await runAll(makeDryRun())).results;
    return { date: "2026-11-05T00:00:00.000Z", commit: "abc1234", mode, arm: "harness", k: 1, summary: aggregate(results), results };
  };
  it("names the file <commit>-<mode>-<arm>.json", () => {
    expect(runFileName("abc1234", "live", "baseline")).toBe("abc1234-live-baseline.json");
  });
  it("SEEDED BAD: a dry run cannot write a results file, a calibration record or the release summary", async () => {
    const dir = tmp();
    const r = await rec("dry");
    expect(() => writeRunFile(dir, r)).toThrow(/dry/);
    expect(() => appendCalibration(path.join(dir, "last-run.json"), r)).toThrow(/dry/);
    expect(() => writeSummaryFile(path.join(dir, "eval-summary.json"), [r])).toThrow(/dry/);
    expect(readdirSync(dir)).toEqual([]);
  });
  it("a live record is written once per arm, holds no reply text, and the calibration list appends", async () => {
    const dir = tmp();
    const r = await rec("live");
    const file = writeRunFile(dir, r);
    expect(path.basename(file)).toBe("abc1234-live-harness.json");
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain("bothering me");
    const cal = path.join(dir, "last-run.json");
    appendCalibration(cal, r);
    appendCalibration(cal, r);
    const list = JSON.parse(readFileSync(cal, "utf8"));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ commit: "abc1234", arm: "harness" });
    expect(Object.keys(list[0])).toEqual(expect.arrayContaining(["date", "models", "promptVersions", "verdict", "classCounts"]));
  });
  it("the committed summary is counts only: no latency, no cost, no results", async () => {
    const summary = toCountsOnly(await rec("live"));
    expect(Object.keys(summary)).not.toEqual(expect.arrayContaining(["latency", "cost", "results"]));
    expect(JSON.stringify(summary)).not.toMatch(/latency|usd|p95/i);
    expect(summary).toMatchObject({ commit: "abc1234", arm: "harness" });
  });
});

describe("human sample pool", () => {
  it("keeps the first rep of model-answered cases, never crisis-suite cases or errors, and flags multi-turn items", async () => {
    const s = await runAll(makeDryRun(), 2);
    expect(s.pool.length).toBeGreaterThan(20);
    expect(s.pool.every((x) => x.rep === 0 && x.reply.trim().length > 0)).toBe(true);
    expect(s.pool.some((x) => x.caseId.startsWith("crisis:"))).toBe(false);
    expect(s.pool.find((x) => x.caseId === "practice:pb01")?.multiTurn).toBe(true);
    expect(s.pool.find((x) => x.caseId === "plan:p01")?.multiTurn).toBe(false);
    expect(s.pool.find((x) => x.caseId === "plan:p06")?.input).toBe("ear pain left side 4 days");
    const bad = await runAll(makeDryRun("error"));
    const failed = new Set(bad.results.filter((r) => r.cls === "error").map((r) => r.caseId));
    expect(bad.pool.some((x) => failed.has(x.caseId))).toBe(false);
  });
  it("SEEDED BAD: a dry run cannot write the human sheet; a live one writes sheet and key apart, the sheet without arms", async () => {
    const dir = tmp();
    const a = await runAll(makeDryRun());
    expect(() => writeHumanSample(dir, "abc1234", "dry", a.pool, 1)).toThrow(/dry/);
    expect(readdirSync(dir)).toEqual([]);
    const { sheet, key } = writeHumanSample(dir, "abc1234", "live", a.pool, 1);
    const sheetText = readFileSync(sheet, "utf8");
    expect(sheetText).not.toMatch(/harness|baseline|plan:p/);
    expect(JSON.parse(sheetText)).toHaveLength(20);
    expect(Object.values(JSON.parse(readFileSync(key, "utf8")))[0]).toHaveProperty("arm");
  });
});

describe("estimateRun", () => {
  const models = { quality: "openai/gpt-oss-120b", fast: "openai/gpt-oss-20b" } as const;
  it("harness worst case is 3x the baseline's one attempt per request", () => {
    const h = estimateRun(harnessCases, 3, "harness", models);
    const b = estimateRun(buildCases(data, "baseline"), 3, "baseline", models);
    expect(h.requests).toBeGreaterThan(b.requests);
    expect(b.worstCalls).toBe(b.requests);
    expect(h.worstCalls).toBeGreaterThan(h.expectedCalls);
    expect(h.costUsdWorst).toBeGreaterThan(0);
    expect(formatEstimate("harness", h)).toMatch(/worst-case cost \$/);
  });
  it("an unpriced model makes the cost unknown, not zero", () => {
    expect(estimateRun(harnessCases, 1, "harness", { quality: "x", fast: "y" }).costUsdWorst).toBeNull();
  });
});

describe("loadLiveRun", () => {
  it("stops with a clear message when the adapter module is missing", async () => {
    await expect(loadLiveRun("harness", async () => undefined)).rejects.toThrow(/No live adapter yet/);
  });
});

describe("loadEnvLocal", () => {
  it("loads .env.local into process.env without printing, and restores NODE_ENV", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, ".env.local"), "EVAL_TEST_ONLY_VAR=from-temp-file\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const before = process.env.NODE_ENV;
    loadEnvLocal(dir);
    expect(process.env.EVAL_TEST_ONLY_VAR).toBe("from-temp-file");
    expect(process.env.NODE_ENV).toBe(before);
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    delete process.env.EVAL_TEST_ONLY_VAR;
    vi.restoreAllMocks();
    expect(existsSync(dir)).toBe(true);
  });
});

describe("a live run without a key is skipped, not refused", () => {
  it("liveSkipReason is one line naming only the variable, and is empty when the key is present", () => {
    expect(liveSkipReason({})).toBe("live eval skipped: GROQ_API_KEY not set");
    expect(liveSkipReason({ GROQ_API_KEY: "   " })).toBe("live eval skipped: GROQ_API_KEY not set");
    expect(liveSkipReason({ GROQ_API_KEY: "gsk_x" })).toBeUndefined();
  });
  it("the CLI exits 0 for a skipped run with no verdicts, and still 1 when vitest itself failed", () => {
    expect(exitCodeFor([], 0, 0, true)).toBe(0);
    expect(exitCodeFor([], 1, 0, true)).toBe(1);
    expect(exitCodeFor([], 0, 0, false)).toBe(1); // no verdicts and not skipped is still misuse
  });
});
