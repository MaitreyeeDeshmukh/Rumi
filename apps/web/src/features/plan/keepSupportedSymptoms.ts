import type { GuardCode } from "@/features/shared/guards";
import { contentWords } from "@/lib/text/tokens";

/** Plural tolerance only: headaches and headache are the same word. */
const stem = (w: string): string => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const stems = (text: string): Set<string> => new Set(contentWords(text).map(stem));

/** Symptoms the user actually wrote: each must share a content word with their own text. */
export function keepSupportedSymptoms(rawText: string, symptoms: readonly string[]): string[] {
  const have = stems(rawText);
  return symptoms.filter((s) => [...stems(s)].some((w) => have.has(w)));
}

/**
 * 07 D10: the main concern must come from the user's words (at least half of its content words appear in them).
 * If the user's text has no content word at all (ok, hi, digits, emoji) there is nothing to compare, so the rule is
 * skipped and the plan uses the fixed prompt.
 */
export function mainConcernCodes(rawText: string, mainConcern: string): GuardCode[] {
  const have = stems(rawText);
  if (have.size === 0) return [];
  const concern = [...stems(mainConcern)];
  return concern.length > 0 && concern.filter((w) => have.has(w)).length * 2 >= concern.length ? [] : ["main_concern_not_from_user"];
}
