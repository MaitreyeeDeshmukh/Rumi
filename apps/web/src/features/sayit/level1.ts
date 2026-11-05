import { harmWording, isQuestion } from "@/features/shared/claims";
import type { GuardCode } from "@/features/shared/guards";
import type { EvidenceLedger } from "@/features/shared/task";
import { allStems, contentStems, stem } from "@/lib/text/stems";
import { normalizeText, splitSentences } from "@/lib/text/tokens";

const STARTER = /you can start with:/i;
const FIRST_PERSON = /\b(i|me|my|mine)\b/i;
const ADDRESSES_YOU = /\byou\b/i;
export const MAX_STARTER_WORDS = 4;
/** Words a starter may use without the user having said them: they carry no fact about the person. */
const NEUTRAL = new Set([
  "sure", "started", "start", "happens", "happen", "happened", "book", "arrive", "say", "write", "down", "know", "tell", "explain", "repeat",
  "understand", "mean", "visit", "appointment", "feel", "feels", "last", "lasts", "notice", "begin", "began", "come", "comes", "think", "seem", "seems", "first", "before", "also", "then", "they",
].map(stem));

/**
 * 07 D13. A level-1 hint is a question, not a statement about the user: EXACTLY one question sentence, then the fixed
 * "You can start with:" and a short starter. Any other sentence (a statement, "It could be serious.") is hard.
 * Hard `level1_statement`: a hint that is not one question plus the starter; a first-person word in a question that does not
 * speak to "you" (inside "Can you tell me when it started?" the "me" is the helper); a digit anywhere; any self-harm or abuse
 * wording; or a starter that is more than one short phrase (at most 4 words, no sentence end) or that uses a content word
 * which is neither in the ledger (what the user said) nor a neutral word like "sure" or "started". So the starter can not carry a claim.
 * Soft `level1_no_question`: no question mark.
 */
export function level1Codes(script: string, ledger?: EvidenceLedger): GuardCode[] {
  const text = normalizeText(script);
  const at = text.search(STARTER);
  const head = at < 0 ? text : text.slice(0, at);
  const starter = at < 0 ? "" : text.slice(at).replace(STARTER, "").replace(/(\.{2,}|…)\s*$/, "");
  const said = allStems(ledger?.items.map((i) => i.text).join("\n") ?? "");
  const claims = contentStems(starter).some((w) => !NEUTRAL.has(w) && !said.has(w));
  const sentences = splitSentences(head);
  const oneQuestion = sentences.length === 1 && isQuestion(sentences[0]);
  const meansUser = sentences.some((s) => isQuestion(s) && FIRST_PERSON.test(s) && !ADDRESSES_YOU.test(s));
  const statement =
    at < 0 ||
    !oneQuestion ||
    meansUser ||
    harmWording(script) ||
    /\d/.test(text) ||
    /[.!?]/.test(starter) ||
    starter.trim().split(/\s+/).filter(Boolean).length > MAX_STARTER_WORDS ||
    claims;
  return [...(statement ? (["level1_statement"] as const) : []), ...(text.includes("?") ? [] : (["level1_no_question"] as const))];
}
