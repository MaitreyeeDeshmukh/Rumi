/**
 * The plan that goes with SAMPLE_VISIT. Used by the Remember screen when no plan exists yet, by the plan mock,
 * and by tests. q4 is an accommodation so the practice focus "needs" is never empty.
 */
import type { VisitPlan } from "@/features/shared/types";

export const DEMO_PLAN: VisitPlan = {
  id: "plan-demo",
  title: "Visit plan",
  createdAt: "2026-11-05T09:00:00.000Z",
  mainConcern: "I keep getting headaches",
  symptomsInMyWords: ["headaches", "forget things"],
  items: [
    { id: "q1", text: "I want to tell you about my headaches.", kind: "concern", source: "user", enabled: true },
    { id: "q2", text: "I want to ask why I get these headaches.", kind: "question", source: "user", enabled: true },
    { id: "q3", text: "I want to ask what I should do next.", kind: "question", source: "suggested", enabled: true },
    { id: "q4", text: "I want to ask if I can have instructions in writing.", kind: "accommodation", source: "suggested", enabled: true },
  ],
};
