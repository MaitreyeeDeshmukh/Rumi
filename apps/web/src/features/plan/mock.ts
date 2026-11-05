import type { PlanReplyT } from "@/features/shared/schemas";
import { DEMO_PLAN } from "@/fixtures/demoPlan";

/**
 * MOCK_AI plan: the demo plan for "I keep getting headaches, my mom always talks for me, I forget things."
 * The two suggested items start switched off, as the real task returns them.
 */
export function planMock(): PlanReplyT {
  return { plan: { ...DEMO_PLAN, items: DEMO_PLAN.items.map((i) => (i.source === "suggested" ? { ...i, enabled: false } : i)) } };
}
