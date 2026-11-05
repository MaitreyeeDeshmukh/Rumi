import { claimKeys, harmWording } from "@/features/shared/claims";
import type { GuardCode } from "@/features/shared/guards";
import { ledgerFromTexts, ungroundedSpecifics } from "@/lib/text/specifics";
import { allStems, contentStems } from "@/lib/text/stems";

/** What a text needs to be backed (its content words, plural and tense folded) and what a text says (every word, plus the words that mean the same: head and headache, angry and anger, swollen and swelling). */
const needs = (text: string): string[] => contentStems(text);
const says = (text: string): Set<string> => allStems(text);

/**
 * Symptoms the user actually wrote: EVERY content word of the symptom must be in their own text, so "headaches and
 * nausea" is dropped when only headaches was written. A symptom with no content word is dropped too.
 */
export function keepSupportedSymptoms(rawText: string, symptoms: readonly string[]): string[] {
  const have = says(rawText);
  return symptoms.filter((s) => {
    const own = needs(s);
    return own.length > 0 && own.every((w) => have.has(w));
  });
}

/** True when the text shares at least one content stem with the user's words. The words of a user item must come from there. */
export function sharesStem(rawText: string, text: string): boolean {
  const have = says(rawText);
  return needs(text).some((w) => have.has(w));
}

/**
 * 07 D10: the main concern must come from the user's words (at least half of its content words appear in them).
 * If the user's text has no content word at all (ok, hi, digits, emoji) there is nothing to compare, so the rule is
 * skipped and the plan uses the fixed prompt.
 */
export function mainConcernCodes(rawText: string, mainConcern: string): GuardCode[] {
  if (needs(rawText).length === 0) return [];
  const have = says(rawText);
  const concern = needs(mainConcern);
  return concern.length > 0 && concern.filter((w) => have.has(w)).length * 2 >= concern.length ? [] : ["main_concern_not_from_user"];
}

const EMPTY = ledgerFromTexts([]);
const MEDICAL = /\b(pain|aches?|hurts?|symptoms?|medic\w+|doses?|dosage|pills?|tablets?|drugs?|tests?|scans?|blood|x-?rays?|diagnos\w+|treatments?|surgery|injections?|prescri\w+)\b/i;

/**
 * Hard checks on the items a model returns. `no_user_items`: nothing the user wrote became an item.
 * `specific_suggestion`: a suggested item (our own idea, not the user's) mentions a body problem, a test, a medicine,
 * a number, a name or any other specific. Suggested items must stay as generic as "I want to ask what I should do next."
 */
export function planItemCodes(items: readonly { text: string; source: "user" | "suggested" }[]): GuardCode[] {
  const codes: GuardCode[] = [];
  if (!items.some((i) => i.source === "user")) codes.push("no_user_items");
  // Numbers, names, months and medicines are all "ungrounded" against an empty ledger.
  // A suggested item may not name a condition, symptom, feeling, medicine, sleep, history or any other claim class either.
  const specific = (text: string): boolean => MEDICAL.test(text) || !ungroundedSpecifics(text, EMPTY).ok || claimKeys(text).size > 0 || harmWording(text);
  if (items.some((i) => i.source === "suggested" && specific(i.text))) codes.push("specific_suggestion");
  return codes;
}
