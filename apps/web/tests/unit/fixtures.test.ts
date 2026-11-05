import { describe, expect, it } from "vitest";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { SAVED_RECAP_REPLY } from "@/fixtures/sampleRecap";
import { SAMPLE_VISIT, SAMPLE_VISIT_LABEL } from "@/fixtures/sampleVisit";
import { FOCUS_VALUES } from "@/features/shared/constants";
import { PlanReply, RecapReply, RecapRequest, VisitPlanSchema } from "@/features/shared/schemas";

describe("sample visit", () => {
  it("has the 16 labelled lines the demo needs and passes the recap request schema", () => {
    expect(SAMPLE_VISIT).toHaveLength(16);
    expect(RecapRequest.safeParse({ lines: SAMPLE_VISIT, mySpeaker: "B", plan: DEMO_PLAN }).success).toBe(true);
    expect(SAMPLE_VISIT_LABEL).toBe("Sample visit, made by our team");
  });

  it("has a clinician, the user, Mom, one medicine and one unclear line", () => {
    expect(new Set(SAMPLE_VISIT.map((l) => l.speaker))).toEqual(new Set(["A", "B", "C"]));
    expect(SAMPLE_VISIT.filter((l) => /ibuprofen/i.test(l.text))).toHaveLength(1);
    expect(SAMPLE_VISIT.filter((l) => l.text.includes("[unclear]"))).toHaveLength(1);
  });
});

describe("demo plan", () => {
  it("is a valid plan with four enabled items and every kind present", () => {
    expect(VisitPlanSchema.safeParse(DEMO_PLAN).success).toBe(true);
    expect(DEMO_PLAN.items.map((i) => i.id)).toEqual(["q1", "q2", "q3", "q4"]);
    expect(DEMO_PLAN.items.every((i) => i.enabled)).toBe(true);
    expect(new Set(DEMO_PLAN.items.map((i) => i.kind))).toEqual(new Set(["concern", "question", "accommodation"]));
  });

  it("fits in a reply", () => {
    expect(PlanReply.safeParse({ plan: DEMO_PLAN }).success).toBe(true);
    expect(FOCUS_VALUES).toContain("needs");
  });
});

describe("saved recap", () => {
  it("parses as a recap reply, with dropped 0 and fixed-template unconfirmed lines", () => {
    const parsed = RecapReply.parse(SAVED_RECAP_REPLY);
    expect(parsed.dropped).toBe(0);
    expect(parsed.unconfirmed.every((u) => u.startsWith("I could not confirm this: "))).toBe(true);
  });

  it("only cites lines that exist and plan items of the demo plan", () => {
    const ids = new Set(SAMPLE_VISIT.map((l) => l.id));
    const planIds = new Set(DEMO_PLAN.items.map((i) => i.id));
    for (const i of SAVED_RECAP_REPLY.items) for (const e of i.evidence) expect(ids.has(e)).toBe(true);
    for (const p of SAVED_RECAP_REPLY.planStatus) expect(planIds.has(p.itemId)).toBe(true);
    expect(SAVED_RECAP_REPLY.planStatus).toHaveLength(DEMO_PLAN.items.length);
  });
});
