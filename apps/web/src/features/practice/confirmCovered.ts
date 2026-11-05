import { enabledItems } from "@/features/practice/labels";
import type { VisitPlan } from "@/features/shared/types";
import { sharesContentWord } from "@/lib/text/tokens";

/**
 * 07 D12: the model proposes which plan items the user covered; code confirms. An id is kept only if it is an
 * enabled item of this plan and the user said at least one of its content words in one of `meTurns`.
 * (Lenient on purpose: it answers "did the user touch this item", and the summary line rests on it.)
 */
export function confirmCovered(modelIds: readonly string[], plan: VisitPlan, meTurns: readonly string[]): string[] {
  const text = new Map(enabledItems(plan).map((i) => [i.id, i.text]));
  const kept = new Set<string>();
  for (const id of modelIds) {
    const itemText = text.get(id);
    if (itemText !== undefined && meTurns.some((t) => sharesContentWord(itemText, t))) kept.add(id);
  }
  return [...kept];
}
