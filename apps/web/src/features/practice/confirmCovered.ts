import { enabledItems } from "@/features/practice/labels";
import type { VisitPlan } from "@/features/shared/types";
import { allStems, contentStems } from "@/lib/text/stems";

/**
 * Did one user turn touch this plan item? It must share at least two of the item's content words (or all of them when
 * the item has fewer than two) and at least half of them. One stray word ("I am writing a note" for "instructions in
 * writing") is not enough. Plural and tense forms count as the same word, and a few clinical synonyms too (head and
 * headache, now and next, written and writing).
 * A user who asks for something "in writing" in other words ("Can you write that down for me?", "Can I get this in
 * writing?") touches an item about writing, because the phrase says the whole request.
 * KNOWN LIMIT: a question item whose key word is a single "why" ("I keep asking myself why this happens" for "why do I get
 * these headaches") is not credited; the user did not say what they asked about.
 */
const IN_WRITING = /\b(in writing|written down|write\b.{0,25}\bdown|on paper)\b/;
function touches(itemText: string, turn: string): boolean {
  const need = contentStems(itemText);
  const said = allStems(turn);
  if (need.includes("writ") && IN_WRITING.test(turn.toLowerCase())) return true;
  const shared = need.filter((w) => said.has(w)).length;
  return need.length > 0 && shared >= Math.min(2, need.length) && shared * 2 >= need.length;
}

/**
 * 07 D12: the model proposes which plan items the user covered; code confirms. An id is kept only if it is an
 * enabled item of this plan and one of `meTurns` touches it (see `touches`). The summary line rests on this.
 */
export function confirmCovered(modelIds: readonly string[], plan: VisitPlan, meTurns: readonly string[]): string[] {
  const text = new Map(enabledItems(plan).map((i) => [i.id, i.text]));
  const kept = new Set<string>();
  for (const id of modelIds) {
    const itemText = text.get(id);
    if (itemText !== undefined && meTurns.some((t) => touches(itemText, t))) kept.add(id);
  }
  return [...kept];
}
