import { FIXED_ITEM, planFallback } from "@/features/plan/fallback";
import type { PlanReplyT, PlanRequestT } from "@/features/shared/schemas";
import { DEMO_PLAN } from "@/fixtures/demoPlan";

/**
 * MOCK_AI plan: the user's own sentences as items (so the demo shows what was typed, not a stock headache plan),
 * followed by the demo's two generic suggested items, switched off as the real task returns them.
 * Text with nothing to copy (ok, hi, emoji) gets the fixed prompt, like the real task.
 */
export function planMock(r: PlanRequestT): PlanReplyT {
  const built = planFallback(r, new Date().toISOString());
  const own: PlanReplyT = { ...built };
  delete own.degraded; // a mock is not a failure
  if (built.plan.items.length === 1 && built.plan.items[0].text === FIXED_ITEM) return own;
  const suggested = DEMO_PLAN.items.filter((i) => i.source === "suggested").map((i) => ({ ...i, enabled: false }));
  const items = [...built.plan.items.slice(0, 10), ...suggested].map((item, n) => ({ ...item, id: `q${n + 1}` }));
  return { ...own, plan: { ...built.plan, items } };
}
