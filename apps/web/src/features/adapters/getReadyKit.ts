// Get ready: the plan call, the support card and the kit text. Card and kit text come from the real support/share code.
import { CARD_TEXT } from "@/content/getReady";
import { MAX_CUSTOM_WORDS } from "@/features/support/presets";
import { GetReadyChatReply, PlanReply } from "@/features/shared/schemas";
import type { ApiResult, SupportCard, SupportItem } from "@/features/shared/types";
import { callApi } from "@/lib/api/callApi";
import { literalLint } from "@/lib/literalLint";
import { splitSentences } from "@/lib/text/tokens";

export { buildKitText } from "@/features/share/buildKitText";
export { shouldPlayFinishSound } from "@/features/share/finishSound";
export { buildSupportCardText, newSupportCard } from "@/features/support/card";
export { MAX_CUSTOM_WORDS };
/** Top questions on the card. Same number as the support card builder. */
export const MAX_QUESTIONS = 2;
export { PlanReply };
export type PlanReply = typeof PlanReply._output;

/** Asks for a plan. What the person typed is checked for a crisis before it leaves the device. */
export const planCall = (rawText: string, companionName: string): Promise<ApiResult<PlanReply>> =>
  callApi("/api/plan", { rawText, companionName }, PlanReply, { typedText: [rawText] });

/** One chat turn: what the person has said so far (one message per line) and what was already asked. Checked for a crisis before it leaves the device. */
export const chatCall = (rawText: string, asked: string[], skipped: number, companionName: string): Promise<ApiResult<typeof GetReadyChatReply._output>> =>
  callApi("/api/get-ready/chat", { rawText, asked, skipped, companionName }, GetReadyChatReply, { typedText: [rawText] });

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Adds one of the person's own sentences. The error text comes from the content file. */
export function addCustomItem(card: SupportCard, text: string): { card: SupportCard; error?: string } {
  const t = text.trim();
  if (!t) return { card, error: CARD_TEXT.customEmpty };
  if (wordCount(t) > MAX_CUSTOM_WORDS || !literalLint(t).ok) return { card, error: CARD_TEXT.customLong };
  const n = card.items.filter((i) => i.source === "user").length + 1;
  const item: SupportItem = { id: "u" + n, text: t, source: "user", enabled: true };
  return { card: { ...card, items: [...card.items, item] } };
}

const ASKING = /^(?:can|could|will|would|should|do|does|is|are|what|when|where|how|why|which|who)\b/i;
const NEEDING = /\b(?:i need|please|slowly|quiet|explain|write(?:\s+it)?\s+down|in writing|bring (?:someone|a friend|my)|interpreter|more time|one thing at a time)\b/i;

/**
 * Whatever the person types becomes plan lines: several ideas, a list or a paragraph are split into one line each,
 * and each line is sorted as something to tell, to ask, or a need. Lines stay within the schema limit.
 */
export function splitIntoPlanLines(text: string): { text: string; kind: "concern" | "question" | "accommodation" }[] {
  return splitSentences(text.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, ""))
    .map((s) => s.trim().slice(0, 200))
    .filter((s) => s.length > 0)
    .map((line) => ({
      text: line,
      kind: line.endsWith("?") || ASKING.test(line) ? "question" : NEEDING.test(line) ? "accommodation" : "concern",
    }));
}
