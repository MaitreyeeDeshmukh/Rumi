// Get ready: the plan call, the support card and the kit text. Card and kit text come from the real support/share code.
import { CARD_TEXT } from "@/content/getReady";
import { MAX_CUSTOM_WORDS } from "@/features/support/presets";
import { PlanReply } from "@/features/shared/schemas";
import type { ApiResult, SupportCard, SupportItem } from "@/features/shared/types";
import { callApi } from "@/lib/api/callApi";
import { literalLint } from "@/lib/literalLint";

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
