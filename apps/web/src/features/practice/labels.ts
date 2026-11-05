/** Practice labels: the model sees q1..qn, never ids. Pure helpers for focus text, focus filtering and label mapping. */
import type { GuardCode } from "@/features/shared/guards";
import type { Focus, PlanItem, VisitPlan } from "@/features/shared/types";

export const FOCUS_LABEL: Record<Focus, string> = {
  problem: "Explain my problem",
  questions: "Ask my questions",
  needs: "Ask for what I need",
  next_steps: "Understand what to do next",
  whole: "The whole visit",
};

/** Own-property lookup: a focus from the browser such as "__proto__" or "constructor" gets the whole-visit label. */
export function focusLabel(focus: string): string {
  return Object.hasOwn(FOCUS_LABEL, focus) ? FOCUS_LABEL[focus as Focus] : FOCUS_LABEL.whole;
}

/** Enabled items that belong to the chosen focus. next_steps and whole use every enabled item. */
export function itemsForFocus(plan: VisitPlan, focus: Focus): PlanItem[] {
  const kind = focus === "problem" ? "concern" : focus === "questions" ? "question" : focus === "needs" ? "accommodation" : undefined;
  return plan.items.filter((i) => i.enabled && (kind === undefined || i.kind === kind));
}

export interface LabelledItem {
  label: string;
  id: string;
  text: string;
}

/** Enabled plan items with positional labels q1..qn. */
export const enabledItems = (plan: VisitPlan): LabelledItem[] =>
  plan.items.filter((i) => i.enabled).map((i, n) => ({ label: `q${n + 1}`, id: i.id, text: i.text }));

/** Real ids for the labels the model returned. Unknown labels are dropped; each id appears once. */
export function idsForLabels(plan: VisitPlan, labels: readonly string[]): string[] {
  const byLabel = new Map(enabledItems(plan).map((i) => [i.label, i.id]));
  return [...new Set(labels.map((l) => byLabel.get(l)).filter((id): id is string => id !== undefined))];
}

/** Hard `unknown_label` if any label is not one of q1..qn for this plan. */
export function unknownLabelCodes(plan: VisitPlan, labels: readonly string[]): GuardCode[] {
  const known = new Set(enabledItems(plan).map((i) => i.label));
  return labels.every((l) => known.has(l)) ? [] : ["unknown_label"];
}
