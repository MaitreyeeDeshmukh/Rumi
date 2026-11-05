import { describe, expect, it } from "vitest";
import { GUARD_LOG_RE } from "@/features/shared/guards";
import { aiRecord, type AiEvent } from "@/lib/ai/telemetry";

const base: AiEvent = {
  id: "5f1d7c52-8f58-4d52-9a47-0f7a1b2c3d4e",
  task: "plan",
  promptVersion: "plan@3",
  outcome: "fallback",
  degraded: true,
  attempts: 3,
  tier: "fast",
  redactions: 2,
  injectionHits: 1,
  thin: true,
  guardHits: ["advice_dose", "lint_idiom"],
  memoryItems: 2,
  inTokens: 812,
  outTokens: 190,
  ms: 4123,
  errorCode: "ai_unavailable",
};

/** The line the writer produces for an event: one JSON string of the record. */
const capture = (e: unknown): string[] => [JSON.stringify(aiRecord(e as AiEvent))];

describe("aiRecord", () => {
  it("writes one JSON line with counts, ids and guard labels", () => {
    const lines = capture(base);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      type: "ai_task",
      id: base.id,
      task: "plan",
      promptVersion: "plan@3",
      outcome: "fallback",
      degraded: true,
      attempts: 3,
      tier: "fast",
      redactions: 2,
      injectionHits: 1,
      thin: true,
      guardHits: ["hard:advice_dose", "soft:lint_idiom"],
      memoryItems: 2,
      inTokens: 812,
      outTokens: 190,
      ms: 4123,
      errorCode: "ai_unavailable",
    });
  });

  it("every guard hit looks like hard:code or soft:code", () => {
    const parsed = JSON.parse(capture(base)[0]) as { guardHits: string[] };
    for (const h of parsed.guardHits) expect(h).toMatch(GUARD_LOG_RE);
  });

  it("cannot carry user text, memory text or a key, even when a caller smuggles them in", () => {
    const secrets = ["my head hurts 602-555-0100", "Please speak slowly", "gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123", "hunter2 SESSION_SECRET"];
    const evil = {
      ...base,
      id: secrets[0],
      promptVersion: secrets[1],
      errorCode: secrets[2],
      task: secrets[3],
      outcome: secrets[0],
      tier: secrets[1],
      guardHits: [`hard:advice_dose:${secrets[0]}`, secrets[1], "advice_dose"],
      rawText: secrets[0],
      memory: [secrets[1]],
      apiKey: secrets[2],
      reply: { clinicianSay: secrets[3] },
      ms: `${secrets[0]}`,
      attempts: Number.NaN,
      inTokens: -5,
    };
    const [line] = capture(evil);
    for (const s of secrets) expect(line).not.toContain(s);
    for (const part of ["602-555", "speak slowly", "gsk_", "hunter2", "rawText", "apiKey", "clinicianSay"]) expect(line).not.toContain(part);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.guardHits).toEqual(["hard:advice_dose"]);
    expect(parsed.ms).toBe(0);
    expect(parsed.attempts).toBe(0);
    expect(parsed.inTokens).toBe(0);
    expect(Object.keys(parsed).sort()).toEqual(
      ["type", "id", "task", "promptVersion", "outcome", "degraded", "attempts", "tier", "redactions", "injectionHits", "thin", "guardHits", "memoryItems", "inTokens", "outTokens", "ms", "errorCode"].sort(),
    );
  });

  it("omits errorCode when there is none and never throws on a bad event", () => {
    expect(JSON.parse(capture({ ...base, errorCode: undefined })[0])).not.toHaveProperty("errorCode");
    expect(() => capture({})).not.toThrow();
    expect(() => capture(null)).not.toThrow();
  });
});

describe("aiRecord: narrow shapes", () => {
  it("an id is a uuid or 12 hex characters, nothing else", () => {
    for (const ok of [base.id, "0123456789ab"]) expect(JSON.parse(capture({ ...base, id: ok })[0]).id).toBe(ok);
    for (const bad of ["headache", "my-head-hurts", "abcdef", "0123456789abcdef", "ABCDEF123456", "5f1d7c52-8f58-4d52-9a47-0f7a1b2c3d4"]) {
      expect(JSON.parse(capture({ ...base, id: bad })[0]).id).toBe("invalid");
    }
  });

  it("a prompt version is a lowercase name, an at sign and up to three digits", () => {
    for (const ok of ["plan@3", "practice@12", "recap@123"]) expect(JSON.parse(capture({ ...base, promptVersion: ok })[0]).promptVersion).toBe(ok);
    for (const bad of ["plan_v3", "plan@", "plan@1234", "Plan@3", "my_head@3", "a b@3", "plan@3x"]) {
      expect(JSON.parse(capture({ ...base, promptVersion: bad })[0]).promptVersion).toBe("invalid");
    }
  });

  it("attempts is a small integer from 0 to 3", () => {
    for (const [input, expected] of [[0, 0], [2, 2], [3, 3], [4, 3], [99_999, 3], [-1, 0], [1.9, 1], [Number.NaN, 0], ["2", 0]] as const) {
      expect(JSON.parse(capture({ ...base, attempts: input })[0]).attempts).toBe(expected);
    }
  });
});

describe("aiRecord: stage", () => {
  it("is written only when set, and only from the fixed list", () => {
    expect(JSON.parse(capture({ ...base, stage: "prompt" })[0]).stage).toBe("prompt");
    expect(JSON.parse(capture({ ...base, stage: "my head hurts" })[0]).stage).toBe("unknown");
    expect(JSON.parse(capture(base)[0])).not.toHaveProperty("stage");
  });
});
