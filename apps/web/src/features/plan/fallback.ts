/**
 * Plan without a model (07 D17). Built only from the user's own sentences: the first sentence is the concern,
 * each sentence is one item, nothing is added, no symptoms are guessed. Always satisfies PlanReply.
 */
import type { PlanReplyT, PlanRequestT } from "@/features/shared/schemas";
import { LIMITS } from "@/features/shared/constants";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { contentWords, splitSentences } from "@/lib/text/tokens";
import { truncateAtWord } from "@/lib/text/truncate";

/** Tighter than the schema (200 and 300) so a prefix always fits. */
export const FALLBACK_ITEM_MAX = 170;
export const FALLBACK_CONCERN_MAX = 280;
const TELL = "I want to tell you: ";
const ASK = "I want to ask: ";

/** Used when the user's text has no content word (ok, hi, digits only, emoji): nothing to copy, so ask in a fixed way. */
export const FIXED_CONCERN = "I want to talk about my visit";
export const FIXED_ITEM = "I want to tell you what is happening.";

/** Pure, so the same text always gives the same id. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

const LEADING_COURTESY = /^(?:(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening)|sorry|please|okay|ok)\b[\s,!.]*)+/i;
const THANKS_FOR = /^for (?:seeing|helping|your time|having|meeting|taking|listening)\b.*$/i;
/** A sentence is a concern when something is left after greetings and thanks ("Thanks for seeing me." is not one). */
const hasConcern = (s: string): boolean => contentWords(s.replace(LEADING_COURTESY, "").replace(THANKS_FOR, "")).length > 0;

const itemFor =(sentence: string, n: number) => {
  const question = sentence.endsWith("?");
  const prefix = question ? ASK : TELL;
  const text = prefix.length + sentence.length <= FALLBACK_ITEM_MAX ? prefix + sentence : truncateAtWord(sentence, FALLBACK_ITEM_MAX);
  return { id: `q${n + 1}`, text, kind: question ? ("question" as const) : ("concern" as const), source: "user" as const, enabled: true };
};

// Copied text is cleaned here too (bidi overrides, zero-width and control characters), not only by the harness.
const cleanText = (text: string): string => text.replace(/\p{Cf}/gu, "").replace(/(?![\n\t])\p{Cc}/gu, "");

/** The plan id for a text: the same words always give the same id, for the built-in help and for a model answer. */
export const planIdFor = (rawText: string): string => `plan-${fnv1a(cleanText(rawText))}`;

/** `createdAt` is a parameter because the function must stay pure; the caller may pass the real time. */
export function planFallback(r: PlanRequestT, createdAt: string = DEMO_PLAN.createdAt): PlanReplyT {
  const clean = cleanText(r.rawText);
  // A greeting or an "ok" is not a concern: only sentences with at least one content word become items.
  const sentences = splitSentences(clean).filter(hasConcern);
  const id = planIdFor(r.rawText);
  const base = { id, title: "Visit plan", createdAt, symptomsInMyWords: [] };
  if (sentences.length === 0) {
    const item = { id: "q1", text: FIXED_ITEM, kind: "concern" as const, source: "suggested" as const, enabled: true };
    return { plan: { ...base, mainConcern: FIXED_CONCERN, items: [item] }, thin: true, degraded: true };
  }
  const max = LIMITS.planItemsMax;
  const own = sentences.length > max ? sentences.slice(0, max - 1) : sentences;
  const rest = sentences.length > max ? [sentences.slice(max - 1).join(" ")] : [];
  return {
    plan: { ...base, mainConcern: truncateAtWord(sentences[0], FALLBACK_CONCERN_MAX), items: [...own, ...rest].map(itemFor) },
    thin: sentences.length < 2,
    degraded: true,
  };
}
