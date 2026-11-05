import type { GuardCode } from "@/features/shared/guards";
import type { EvidenceLedger } from "@/features/shared/task";
import { allStems, contentStems, stem } from "@/lib/text/stems";
import { normalizeText } from "@/lib/text/tokens";

const STARTER = /you can start with:/i;
const FIRST_PERSON = /\b(i|me|my|mine)\b/i;
const MAX_STARTER_WORDS = 4;
/** Words a starter may use without the user having said them: they carry no fact about the person. */
const NEUTRAL = new Set([
  "sure", "started", "start", "happens", "happen", "book", "arrive", "say", "write", "down", "know", "tell", "explain", "repeat",
  "understand", "mean", "visit", "appointment",
].map(stem));

/**
 * 07 D13. A level-1 hint is a question, not a statement about the user.
 * Hard `level1_statement`: a first-person word outside the "You can start with:" starter, a digit anywhere, or a starter that
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
  const statement =
    FIRST_PERSON.test(head) ||
    /\d/.test(text) ||
    /[.!?]/.test(starter) ||
    starter.trim().split(/\s+/).filter(Boolean).length > MAX_STARTER_WORDS ||
    claims;
  return [...(statement ? (["level1_statement"] as const) : []), ...(text.includes("?") ? [] : (["level1_no_question"] as const))];
}
