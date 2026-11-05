/**
 * Recap without a model (07 D17). The saved recap is used only when the request is the sample visit.
 * Any other transcript gets items built from its own lines, run through verifyEvidence like a model answer would be,
 * and a deterministic planStatus. It states only what a line says, in the line's own words.
 */
import { planStatusFallback, type PlanItemRef } from "@/features/recap/planStatusFallback";
import { NOTHING_CONFIRMED, recapEmptyCodes, verifyEvidence } from "@/features/recap/verifyEvidence";
import { COMMON_DRUGS, toSet } from "@/features/shared/lists";
import type { RecapReplyT, RecapRequestT } from "@/features/shared/schemas";
import type { RecapItem, Speaker, TranscriptLine } from "@/features/shared/types";
import { SAVED_RECAP_REPLY } from "@/fixtures/sampleRecap";
import { SAMPLE_VISIT } from "@/fixtures/sampleVisit";
import { contentWords, splitSentences, wordList } from "@/lib/text/tokens";
import { truncateAtWord } from "@/lib/text/truncate";

const DRUGS = toSet(COMMON_DRUGS);
const INSTRUCTION = /\b(please|keep|bring|write|take|follow|call|avoid|drink|rest|use|try)\b/i;
const NEXT_STEP = /\b(come back|follow.?up|appointment|book|schedule|see you|next visit|referral)\b/i;
const MAX_ITEMS = 20;

const sameLines = (a: readonly TranscriptLine[], b: readonly TranscriptLine[]): boolean =>
  a.length === b.length && a.every((l, n) => l.id === b[n].id && l.speaker === b[n].speaker && l.text === b[n].text);

function itemsFrom(lines: readonly TranscriptLine[], mySpeaker: Speaker): RecapItem[] {
  const items: RecapItem[] = [];
  for (const line of lines) {
    if (/\[\s*unclear\s*\]/i.test(line.text)) continue;
    const text = truncateAtWord(line.text, 300);
    const drug = wordList(line.text).find((w) => DRUGS.has(w));
    if (drug) {
      const sentence = splitSentences(line.text).find((s) => wordList(s).includes(drug)) ?? line.text;
      items.push({ section: "medications", text: truncateAtWord(`${drug[0].toUpperCase()}${drug.slice(1)}: ${sentence}`, 300), evidence: [line.id] });
    } else if (contentWords(line.text).length >= 3) {
      const mine = line.speaker === mySpeaker;
      const section = mine ? "discussed" : NEXT_STEP.test(line.text) ? "next_steps" : INSTRUCTION.test(line.text) ? "instructions" : "discussed";
      items.push({ section, text, evidence: [line.id] });
    }
  }
  return items.slice(0, MAX_ITEMS);
}

export function recapFallback(r: RecapRequestT): RecapReplyT {
  const plan: PlanItemRef[] = (r.plan?.items ?? []).filter((i) => i.enabled).map((i) => ({ id: i.id, text: i.text }));
  if (sameLines(r.lines, SAMPLE_VISIT)) {
    const planStatus = r.plan ? planStatusFallback(r.lines, r.mySpeaker, plan) : r.mySpeaker === "B" ? SAVED_RECAP_REPLY.planStatus : [];
    return { ...SAVED_RECAP_REPLY, planStatus, degraded: true };
  }
  const v = verifyEvidence(r.lines, { items: itemsFrom(r.lines, r.mySpeaker), planStatus: [] }, r.mySpeaker, plan);
  const unconfirmed = recapEmptyCodes(v).length > 0 ? [NOTHING_CONFIRMED] : v.unconfirmed;
  return { items: v.items, unconfirmed, planStatus: v.planStatus, dropped: v.dropped, degraded: true };
}
