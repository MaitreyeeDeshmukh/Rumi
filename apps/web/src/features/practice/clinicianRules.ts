/**
 * What the pretend clinician may never say, beyond the findings and claims the harness already checks for every
 * practice answer (clinician_finding digits and results, claims_human, advice). These are the rest of "Dr. Lee only asks":
 * no statement about the user's body or history that the user did not give, no "you said X" for an X the user never said,
 * no prescribing, no orders ("you must"), no answering for the user, no "you are fine", no role that is not Dr. Lee,
 * and no talk about the rules themselves. Questions are exempt from the claim check ("Any chest pain?" asks, it does not say).
 * Lexical, English only: it is a floor, and the retry and the built-in script cover what it blocks.
 */
import { inventedClaimCodes } from "@/features/shared/claims";
import type { GuardCode } from "@/features/shared/guards";
import { allStems, contentStems } from "@/lib/text/stems";
import { normalizeText, splitSentences } from "@/lib/text/tokens";
import { ADVICE_REFUSAL, CLOSING_LINE, NOTES_LINE, STOP_LINE, WAIT_LINE } from "../../../prompts/persona";

const FIXED_LINES = [ADVICE_REFUSAL, WAIT_LINE, STOP_LINE, CLOSING_LINE, NOTES_LINE];

/** The text without Dr. Lee's own fixed sentences, which are allowed whatever they contain ("Help me say it"). */
export const withoutFixedLines = (text: string): string => FIXED_LINES.reduce((t, line) => t.split(line).join(" "), text);

const SCALE = /\b[01]\s*(?:to|-|through)\s*(?:5|10)\b/g;
/** What the grounding check reads: no fixed sentences, and the pain scale "1 to 10" (a question about a scale, not a number about the user). */
export const forGrounding = (text: string): string => withoutFixedLines(text).replace(SCALE, " ");

const ROLE = /\bphysician\b|\bas your (?:real |actual )?(?:doctor|physician|clinician|nurse|gp)\b|\bi (?:am|'m|m) (?:your )?(?:real |actual )?(?:doctor|physician|nurse|surgeon)\b/;
const FINDING = /\byou (?:are|'re|look|seem|sound) (?:totally |completely |perfectly |just )?(?:fine|healthy|well|okay|ok|normal|good)\b|\byou (?:have|'ve got|are suffering|suffer)\b/;
const PRESCRIBE = /\bprescrib\w*|\bi (?:will|'ll|would|can|am going to|'m going to) (?:recommend|suggest|give you|order|refer)\b/;
const ORDER = /\byou (?:must|should|need to|have to|ought to)\b/;
const ANSWER_FOR = /\b(?:let me|i will|i'll|i can) answer (?:that |it )?for you\b|\banswer for you\b/;
const LEAK = /\bignore (?:all |the |any )?(?:previous|above|prior|earlier)\b|\bsystem prompt\b|\bas an ai language model\b|\bmy instructions\b/;
const YOU_SAID = /\byou (?:said|told me|mentioned|say|just said|have said|reported)\b([^.?!]*)/;

/** Hard codes for what Dr. Lee wrote. `said` is everything the user gave: their turns and their plan. */
export function clinicianRuleCodes(say: string, said: readonly string[]): GuardCode[] {
  const own = withoutFixedLines(say);
  const have = allStems(said.join("\n"));
  const codes: GuardCode[] = [];
  for (const sentence of splitSentences(own)) {
    const t = normalizeText(sentence).toLowerCase().replace(/[’‘]/g, "'");
    const question = sentence.trim().endsWith("?");
    if (ROLE.test(t)) codes.push("claims_human");
    if (PRESCRIBE.test(t) || ORDER.test(t)) codes.push("advice_treatment");
    if (LEAK.test(t)) codes.push("schema");
    if (ANSWER_FOR.test(t)) codes.push("invented_specific");
    const said1 = YOU_SAID.exec(t);
    if (!question) {
      // What follows "you said" is the user's own claim being repeated back, judged below against what they said.
      if (FINDING.test(said1 === null ? t : t.slice(0, said1.index))) codes.push("clinician_finding");
      codes.push(...inventedClaimCodes(sentence, said));
    }
    if (said1 !== null && contentStems(said1[1]).some((w) => !have.has(w))) codes.push("invented_specific");
  }
  return codes.filter((c, n) => codes.indexOf(c) === n);
}
