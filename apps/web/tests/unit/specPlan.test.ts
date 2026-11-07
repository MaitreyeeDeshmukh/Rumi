import { describe, expect, it } from "vitest";
import { planFallback } from "@/features/plan/fallback";
import { planSpec } from "@/features/plan/spec";
import type { PlanModelOutT, PlanRequestT } from "@/features/shared/schemas";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { PLAN_TASK } from "../../prompts/plan";
import { RUMI_PERSONA } from "../../prompts/persona";
import { check, promptFor } from "./helpers/specCtx";

const R: PlanRequestT = { rawText: "I keep getting headaches. My mom always talks for me. I forget things.", companionName: "Rumi" };

const GOOD: PlanModelOutT = {
  mainConcern: "I keep getting headaches",
  symptomsInMyWords: ["headaches", "forget things"],
  items: [
    { text: "I want to tell you about my headaches.", kind: "concern", source: "user" },
    { text: "I want to say that my mom talks for me.", kind: "accommodation", source: "user" },
    { text: "I want to ask what I should do next.", kind: "question", source: "suggested" },
  ],
  crisis: false,
};
const withItems = (items: PlanModelOutT["items"]): PlanModelOutT => ({ ...GOOD, items });
const userItem = (text: string): PlanModelOutT["items"][number] => ({ text, kind: "concern", source: "user" });

describe("planSpec wiring", () => {
  it("uses the pinned tier, temperature and token cap, the advice guard and memory", () => {
    expect(planSpec).toMatchObject({ name: "plan", promptVersion: "plan@4", tier: "quality", temperature: 0.2, maxOutputTokens: 1200, adviceGuard: true, useMemory: true });
  });

  it("accepts the demo fixtures", () => {
    expect(planSpec.reply.safeParse({ plan: DEMO_PLAN }).success).toBe(true);
    expect(planSpec.request.safeParse(R).success).toBe(true);
  });

  it("mock and fallback satisfy the reply schema", () => {
    expect(planSpec.reply.safeParse(planSpec.mock(R)).success).toBe(true);
    for (const text of [R.rawText, "ok", "😀", "I feel dizzy?", "a".repeat(1900)]) {
      const reply = planSpec.fallback({ ...R, rawText: text });
      expect(planSpec.reply.safeParse(reply).success, text.slice(0, 20)).toBe(true);
      expect(reply.degraded).toBe(true);
    }
  });

  it("the fallback is stamped with the real time, not the demo date (I-027)", () => {
    const reply = planSpec.fallback(R);
    expect(reply.plan.createdAt).not.toBe(DEMO_PLAN.createdAt);
    expect(Math.abs(Date.parse(reply.plan.createdAt) - Date.now())).toBeLessThan(60_000);
  });

  it("the mock echoes the user's own sentences and switches the suggested items off", () => {
    const m = planSpec.mock(R);
    expect(m.degraded).toBeUndefined();
    expect(m.plan.items.filter((i) => i.source === "user").map((i) => i.text.includes(R.rawText.split(".")[0]))[0]).toBe(true);
    expect(m.plan.items.filter((i) => i.source === "suggested").every((i) => !i.enabled)).toBe(true);
    expect(planSpec.reply.safeParse(m).success).toBe(true);
  });

  it("the ledger holds only the user's typed sentences", () => {
    const ledger = planSpec.buildLedger(R);
    expect(ledger.items.map((i) => i.label)).toEqual(["U1", "U2", "U3"]);
    expect(ledger.thin).toBe(false);
    expect(planSpec.buildLedger({ ...R, rawText: "My head hurts." }).thin).toBe(true);
  });
});

describe("planSpec crisisFields", () => {
  it("checks the typed text and nothing else", () => {
    expect(planSpec.crisisFields(R)).toEqual({ rawText: R.rawText });
    expect(Object.keys(planSpec.crisisFields({ ...R, companionName: "I want to die" }))).toEqual(["rawText"]);
  });
});

describe("planSpec validate", () => {
  it("passes a good output", () => {
    expect(check(planSpec, R, GOOD)).toEqual({ hard: [], soft: [] });
  });

  it.each<[string, PlanModelOutT, string]>([
    ["an invented number", { ...GOOD, items: [userItem("I have had headaches for 3 weeks.")] }, "invented_specific"],
    ["an invented medicine", { ...GOOD, items: [userItem("I want to ask about ibuprofen.")] }, "invented_specific"],
    ["an invented name", { ...GOOD, items: [userItem("I saw Dr. Patel about my headaches.")] }, "invented_specific"],
    ["an invented time span in a symptom", { ...GOOD, symptomsInMyWords: ["headaches since last month"] }, "invented_specific"],
    ["a concern the user did not write", { ...GOOD, mainConcern: "I have chest problems" }, "main_concern_not_from_user"],
    ["an empty concern", { ...GOOD, mainConcern: "" }, "main_concern_not_from_user"],
    ["no item from the user", withItems([{ text: "I want to ask what I should do next.", kind: "question", source: "suggested" }]), "no_user_items"],
    ["a suggested item about a symptom", withItems([...GOOD.items, { text: "I want to ask about my back pain.", kind: "question", source: "suggested" }]), "specific_suggestion"],
    ["a suggested item with a number", withItems([...GOOD.items, { text: "I want to ask about the next 2 steps.", kind: "question", source: "suggested" }]), "specific_suggestion"],
    ["an invalid blank", withItems([userItem("I want to say [500 mg].")]), "invalid_blank"],
    ["a whitespace-only item", withItems([...GOOD.items, { text: "   ", kind: "question", source: "user" }]), "empty"],
  ])("hard: %s", (_name, out, code) => {
    expect(check(planSpec, R, out).hard).toContain(code);
  });

  it.each([
    ["a sentence over 15 words", "I want to tell you that my headaches keep coming back and that they make it hard to do my work.", "lint_too_long"],
    ["an idiom", "I want to touch base about my headaches.", "lint_idiom"],
  ] as const)("soft: %s", (_name, text, code) => {
    const { hard, soft } = check(planSpec, R, withItems([userItem(text)]));
    expect(soft).toContain(code);
    expect(hard).toEqual([]);
  });

  it("the escape hatch passes every hard rule: the built-in plan, rebuilt as a model output", () => {
    const fb = planFallback(R);
    const out: PlanModelOutT = { mainConcern: fb.plan.mainConcern, symptomsInMyWords: [], items: fb.plan.items.map(({ text, kind, source }) => ({ text, kind, source })), crisis: false };
    expect(check(planSpec, R, out).hard).toEqual([]);
  });
});

describe("planSpec finalize", () => {
  const ledger = planSpec.buildLedger(R);

  it("gives positional ids, switches suggested items off and keeps only supported symptoms", () => {
    const reply = planSpec.finalize(R, { ...GOOD, symptomsInMyWords: ["headaches", "dizziness"] }, ledger);
    expect(reply.plan.items.map((i) => [i.id, i.source, i.enabled])).toEqual([
      ["q1", "user", true],
      ["q2", "user", true],
      ["q3", "suggested", false],
    ]);
    expect(reply.plan.symptomsInMyWords).toEqual(["headaches"]);
    expect(reply.thin).toBe(false);
    expect(reply.degraded).toBeUndefined();
    expect(planSpec.reply.safeParse(reply).success).toBe(true);
  });

  it("sets thin from the ledger", () => {
    const one = { ...R, rawText: "My head hurts." };
    expect(planSpec.finalize(one, GOOD, planSpec.buildLedger(one)).thin).toBe(true);
  });

  it("stamps the real time and a stable id", () => {
    const a = planSpec.finalize(R, GOOD, ledger).plan;
    expect(Math.abs(Date.parse(a.createdAt) - Date.now())).toBeLessThan(60_000);
    expect(planSpec.finalize(R, GOOD, ledger).plan.id).toBe(a.id);
    expect(a.id).toBe(planSpec.fallback(R).plan.id);
  });

  it("text with no content word gets the fixed plan, not whatever the model wrote, and is not marked degraded", () => {
    const ok = { ...R, rawText: "ok" };
    const reply = planSpec.finalize(ok, GOOD, planSpec.buildLedger(ok));
    expect(reply.plan.mainConcern).toBe("I want to talk about my visit");
    expect(JSON.stringify(reply)).not.toContain("headaches");
    expect(reply.degraded).toBeUndefined();
    expect(reply.thin).toBe(true);
    expect(planSpec.reply.safeParse(reply).success).toBe(true);
  });
});

describe("planSpec build", () => {
  it("is the persona and the task text only: the harness adds the rules and every region", () => {
    const { system, user } = promptFor(planSpec, R);
    expect(system).toBe(RUMI_PERSONA);
    expect(user).toBe(PLAN_TASK);
    for (const text of [system, user]) expect(text).not.toMatch(/<<<|You are Rumi, a helper|LITERAL MODE/);
  });

  it("states the pinned task sentence so the baseline comparison is fair (I-062)", () => {
    expect(promptFor(planSpec, R).user).toContain("Turn the user's own words into a short visit plan for their doctor appointment.");
  });
});
