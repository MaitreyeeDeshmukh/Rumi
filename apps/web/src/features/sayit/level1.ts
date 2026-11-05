import type { GuardCode } from "@/features/shared/guards";
import type { EvidenceLedger } from "@/features/shared/task";
import { allStems, contentStems, stem } from "@/lib/text/stems";
import { normalizeText, splitSentences } from "@/lib/text/tokens";

const STARTER = /you can start with:/i;
const FIRST_PERSON = /\b(i|me|my|mine)\b/i;
const MAX_STARTER_WORDS = 4;
/** Words a starter may use without the user having said them: they carry no fact about the person. */
const NEUTRAL = new Set([
  "sure", "started", "start", "happens", "happen", "book", "arrive", "say", "write", "down", "know", "tell", "explain", "repeat",
  "understand", "mean", "visit", "appointment",
].map(stem));

/** A real question starts with a question word or an auxiliary verb and ends with a question mark. "Your headaches are bad, right?" is a statement with a tag. */
const INTERROGATIVE = /^(?:what|how|when|where|which|who|whom|whose|why|can|could|do|does|did|would|will|is|are|was|were|have|has|shall|may|might|should)\b/i;
const ADDRESSES_YOU = /\byou\b/i;
const SECOND_PERSON = /\b(?:you|your|yours|yourself)\b/i;
const isQuestion = (sentence: string): boolean => sentence.trim().endsWith("?") && INTERROGATIVE.test(sentence.trim());

/**
 * 07 D13. A level-1 hint is a question, not a statement about the user.
 * Hard `level1_statement`: a statement (a sentence that is not a real question) with a first-person or second-person
 * word outside the "You can start with:" starter; a first-person word in a question that does not speak to "you"
 * (inside "Can you tell me when it started?" the "me" is the helper); a digit anywhere; or a starter that
 * is more than one short phrase (at most 4 words, no sentence end) or that uses a content word which is neither in the
 * ledger (what the user said) nor a neutral word like "sure" or "started". So the starter can not carry a claim.
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
  const claimsUser = sentences.some((sentence) =>
    isQuestion(sentence) ? FIRST_PERSON.test(sentence) && !ADDRESSES_YOU.test(sentence) : FIRST_PERSON.test(sentence) || SECOND_PERSON.test(sentence),
  );
  const statement =
    claimsUser ||
    /\d/.test(text) ||
    /[.!?]/.test(starter) ||
    starter.trim().split(/\s+/).filter(Boolean).length > MAX_STARTER_WORDS ||
    claims;
  return [...(statement ? (["level1_statement"] as const) : []), ...(text.includes("?") ? [] : (["level1_no_question"] as const))];
}
