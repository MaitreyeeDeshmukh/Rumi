/**
 * Deterministic planStatus (no model): for each plan item, the transcript line that shares the most content words
 * with it decides. The speaker of that line gives asked_by_me or asked_by_other; no line means not_asked.
 * Also the overlap rule that verifyEvidence uses to accept a model's planStatus claim.
 */
import type { PlanStatusEntry, Speaker, TranscriptLine } from "@/features/shared/types";
import { contentWords, wordSet } from "@/lib/text/tokens";

export interface PlanItemRef {
  id: string;
  text: string;
}

/** Shared content words between a plan item and a line (whole tokens). */
function overlapCount(itemText: string, lineText: string): number {
  const have = wordSet(lineText);
  return [...new Set(contentWords(itemText))].filter((w) => have.has(w)).length;
}

/** At least 40% of the item's content words, and at least one, must be in the line. "Okay." or "Thank you." never match. */
export function lineOverlaps(itemText: string, lineText: string): boolean {
  const need = new Set(contentWords(itemText)).size;
  return overlapCount(itemText, lineText) >= Math.max(1, Math.ceil(need * 0.4));
}

export function planStatusFallback(lines: readonly TranscriptLine[], mySpeaker: Speaker, items: readonly PlanItemRef[]): PlanStatusEntry[] {
  return items.map((item): PlanStatusEntry => {
    let best: TranscriptLine | undefined;
    let bestScore = 0;
    for (const line of lines) {
      const score = lineOverlaps(item.text, line.text) ? overlapCount(item.text, line.text) : 0;
      if (score > bestScore) {
        best = line;
        bestScore = score;
      }
    }
    if (!best) return { itemId: item.id, status: "not_asked", evidence: [] };
    return { itemId: item.id, status: best.speaker === mySpeaker ? "asked_by_me" : "asked_by_other", evidence: [best.id] };
  });
}
