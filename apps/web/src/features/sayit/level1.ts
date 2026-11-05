import type { GuardCode } from "@/features/shared/guards";
import { normalizeText } from "@/lib/text/tokens";

const STARTER = /you can start with:/i;
const FIRST_PERSON = /\b(i|me|my|mine)\b/i;

/**
 * 07 D13. A level-1 hint is a question, not a statement about the user.
 * Hard `level1_statement`: a first-person word or a digit outside the "You can start with:" starter, a digit anywhere,
 * or a starter that is more than one short phrase ending in "..." (so the starter can not carry a real sentence).
 * Soft `level1_no_question`: no question mark.
 */
export function level1Codes(script: string): GuardCode[] {
  const text = normalizeText(script);
  const at = text.search(STARTER);
  const head = at < 0 ? text : text.slice(0, at);
  const starter = at < 0 ? "" : text.slice(at).replace(STARTER, "").replace(/(\.{2,}|…)\s*$/, "");
  const statement =
    FIRST_PERSON.test(head) ||
    /\d/.test(text) ||
    /[.!?]/.test(starter) ||
    starter.trim().split(/\s+/).filter(Boolean).length > 12;
  return [...(statement ? (["level1_statement"] as const) : []), ...(text.includes("?") ? [] : (["level1_no_question"] as const))];
}
