/**
 * Get ready asks, it does not just take whatever was typed. After the first words, Rumi asks up to three short
 * follow-up questions, one at a time, about what is still missing (how long, what worries you, what you want from the
 * visit...). Each answer is the person's own words (typed or tapped) and is added to what they wrote, so the plan is
 * still built only from things they said. Pure: no network, no model. Question texts live in src/content/getReady.ts.
 */
import { GET_READY } from "@/content/getReady";
import { contentWords } from "@/lib/text/tokens";

export type FollowUpId = "reason" | "duration" | "worry" | "goal" | "tried" | "change";

export interface FollowUp {
  id: FollowUpId;
  question: string;
  chips: readonly string[];
}

/** Which slot the words already cover. A slot that is covered is not asked again. */
const COVERED: Record<Exclude<FollowUpId, "reason">, RegExp> = {
  duration: /\b(\d+|one|two|three|few|several|many)\s+(hours?|days?|weeks?|months?|years?)\b|\b(since|ago|yesterday|all day|for ages|every (day|night)|last (week|month|year))\b/i,
  worry: /\b(worr(y|ies|ied)|scared|afraid|anxious|fear|nervous|stress(ed)?)\b/i,
  goal: /\b(i want|i hope|i need|can i|could i|should i|scan|test|referral|prescription|explain|answers?)\b/i,
  tried: /\b(tried|take|taking|took|medicine|medication|pills?|ibuprofen|tablets?|rest|ice|cream|treatment)\b/i,
  change: /\b(worse|better|worsen|improves?|helps?|triggers?|at night|in the morning)\b/i,
};

/** Asked in this order. */
const ORDER: readonly Exclude<FollowUpId, "reason">[] = ["duration", "worry", "goal", "tried", "change"];

/** Enough was written: more questions would only be a chore. */
const PLENTY_WORDS = 60;
export const MAX_FOLLOW_UPS = 3;

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const make = (id: FollowUpId): FollowUp => ({ id, question: GET_READY.follow[id].question, chips: GET_READY.follow[id].chips });

/** The questions to ask for these words, in order. Empty when the words already say enough. */
export function nextFollowUps(text: string): FollowUp[] {
  const t = text.trim();
  // Nothing to build a plan from (a greeting, "ok"): ask what the visit is about first.
  if (contentWords(t).length === 0) return [make("reason"), make("duration"), make("goal")].slice(0, MAX_FOLLOW_UPS);
  if (wordCount(t) >= PLENTY_WORDS) return [];
  return ORDER.filter((id) => !COVERED[id].test(t))
    .slice(0, MAX_FOLLOW_UPS)
    .map(make);
}
