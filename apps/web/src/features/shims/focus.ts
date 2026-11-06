// swap when the lane merges (src/features/practice/labels.ts)
import { FOCUS_LABELS } from "@/content/dashboard";
import type { Focus, PlanItem, VisitPlan } from "@/features/shims/types";

export const FOCUS_LABEL: Record<Focus, string> = FOCUS_LABELS;

const KIND_OF_FOCUS: Partial<Record<Focus, PlanItem["kind"]>> = {
  problem: "concern",
  questions: "question",
  needs: "accommodation",
};

/** The enabled plan lines that belong to a practice focus. */
export function itemsForFocus(plan: VisitPlan, focus: Focus): PlanItem[] {
  const kind = KIND_OF_FOCUS[focus];
  return plan.items.filter((i) => i.enabled && (kind === undefined || i.kind === kind));
}
