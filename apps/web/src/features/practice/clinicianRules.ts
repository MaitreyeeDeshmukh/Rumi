/**
 * What the pretend clinician may never say, beyond the findings and claims the harness already checks for every
 * practice answer (clinician_finding digits and results, claims_human, advice). These are the rest of "Dr. Lee only asks":
 * no statement about the user's body or history that the user did not give, no "you said X" for an X the user never said,
 * no prescribing or referring, no orders ("you must", "go to the emergency room"), no answering for the user, no reassurance
 * or diagnosis ("everything looks fine", "this is likely"), no role that is not Dr. Lee, no talk about the rules themselves,
 * and no self-harm or abuse wording at all (that belongs to the real crisis flow, not to practice).
 * A yes/no question may name a topic ("Any chest pain?", "Do you feel dizzy?"): it asks, it does not say. A wh-question
 * that takes a claim for granted ("When did you start smoking?", "your asthma") is judged like a statement.
 * Lexical, English only: it is a floor, and the retry and the built-in script cover what it blocks.
 */
import { harmWording, inventedClaimCodes, isQuestion, isYesNoQuestion, presupposesClaim } from "@/features/shared/claims";
import type { GuardCode } from "@/features/shared/guards";
import { NUMBER_WORDS, RELATIVE_TIME } from "@/features/shared/lists";
import { allStems, contentStems } from "@/lib/text/stems";
import { normalizeText, splitSentences } from "@/lib/text/tokens";
import { ADVICE_REFUSAL, CLOSING_LINE, NOTES_LINE, STOP_LINE, WAIT_LINE } from "../../../prompts/persona";

const FIXED_LINES = [ADVICE_REFUSAL, WAIT_LINE, STOP_LINE, CLOSING_LINE, NOTES_LINE];

/** The text without Dr. Lee's own fixed sentences, which are allowed whatever they contain ("Help me say it"). */
export const withoutFixedLines = (text: string): string => FIXED_LINES.reduce((t, line) => t.split(line).join(" "), text);

const SCALE = /\b[01]\s*(?:to|-|through)\s*(?:5|10)\b/g;
const alternation = (words: readonly string[]): string => [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const TIME_WORDS = new RegExp(`\\b(?:${alternation(RELATIVE_TIME)}|once|twice|thrice|every other \\w+|(?:an?|each|every|per|the) (?:day|week|month|year|hour|morning|evening|night|afternoon)|(?:\\d+|a few|several|${alternation(NUMBER_WORDS)}) (?:minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|times?))\\b`, "gi");

/**
 * What the grounding check reads: no fixed sentences, no "1 to 10" scale, and, in QUESTIONS only, no frequency or time-span
 * words ("Does it happen every day?", "Has it been three weeks?"). A question that asks about a span states nothing; the same
 * words in a statement are a claim and stay checked.
 */
export function forGrounding(text: string): string {
  return splitSentences(withoutFixedLines(text).replace(SCALE, " "))
    .map((s) => (isQuestion(s) ? s.replace(TIME_WORDS, " ") : s))
    .join(" ");
}

const ROLE =
  /\bphysician\b|\bas (?:your|a|an|the) (?:real |actual |licensed )?(?:doctor|physician|clinician|nurse|gp|professional|specialist)\b|\bi(?:'m| am|m)\b (?:your |a |an )?(?:real |actual |licensed |qualified )?(?:doctor|physician|nurse|surgeon|professional)\b|\bmedical school\b|\b(?:my|our) (?:clinic|patients?|hospital|office|licen[sc]e|practice room|years of)\b|\blicensed (?:professional|doctor|clinician)\b|\bin my (?:experience|clinic|practice)\b/;
const PRESCRIBE =
  /\bprescrib\w*|\bprescription\b|\breferral\b|\bi(?:'ll| will| am going to|'m going to| can| could| would) (?:recommend|suggest|give you|order|refer|start you|put you|get you|schedule|arrange)\b|\bi(?:'m| am) (?:ordering|prescribing|referring|scheduling|giving you|starting you|putting you)\b|\b(?:start|put|get) you on\b|\bgiving you (?:a|an|some)\b|\bordering (?:some |a )?(?:blood |more )?(?:tests?|scans?|x-?rays?)\b|\bwrite (?:a|you a) script\b/;
const ORDER = /\byou (?:must|should|need to|have to|ought to|had better)\b|\bmake sure (?:you|to)\b/;
const IMPERATIVE =
  /^(?:please |now |so |ok |okay |and |also )*(?:take(?! your time| a moment| a minute)|drink|eat|rest|lie|try|go(?! on| ahead)|avoid|do not|don't|dont|stop|use|get|stay|limit|increase|reduce|decrease|sit|exercise|sleep|relax|call|see|visit|seek|phone|book|schedule|apply|massage|stretch|breathe|hydrate|cut)\b/;
const ANSWER_FOR =
  /\b(?:let me|i will|i'll|i can) answer (?:that |it )?for you\b|\banswer for you\b|\bhere(?:'s| is) (?:what|how) (?:to|you (?:could|can|should)) say\b|^(?:please )?say (?:yes|no|that|this)\b|\b(?:tell|say it to) (?:them|him|her) for you\b|\byou (?:could|can) say:|\btry saying\b/;
const LEAK =
  /\bignore (?:all |the |any |these |those )?(?:previous|above|prior|earlier|instructions|rules)\b|\bsystem (?:prompt|message)\b|\b(?:my|your|the) (?:prompt|instructions|rules)\b|\bas an ai language model\b|\bsecrets?\b/;
const FINDING =
  /\byou(?:'re| are| look| seem| sound) (?:totally |completely |perfectly |just )?(?:fine|healthy|well|okay|ok|normal|good)\b|\byou(?:'ve got| have| are suffering| suffer)\b/;
const IMPERSONAL =
  /\b(?:everything|all|it|this|that) (?:looks|seems|sounds) (?:totally |completely |perfectly |quite |very |really )?(?:fine|normal|okay|ok|good|great)\b|\b(?:everything|all) (?:is|was) (?:totally |completely |perfectly |quite |very |really )?(?:fine|normal|okay|ok|good|great)\b|\b(?:it|this|that) (?:is|was) (?:quite |very |really )?(?:normal|common|usual|typical)\b|\bno need to (?:be )?(?:worry|worried|concerned|afraid)\b|\b(?:is|are|be|seems|sounds|looks) (?:likely|probably|possibly)\b|\b(?:could|might|may) be (?:a|an|your|due|caused|because)\b|\bsounds like (?:you|a|an|it)\b|\bnothing (?:to worry|serious|wrong)\b|\byou will be (?:fine|okay|ok)\b/;
const YOU_SAID =
  /\byou(?:'ve| have| had|'d)? (?:just |also |already |did |really )?(?:said|told me|told us|mentioned|say|reported|described|noted|explained|shared|stated|talked about|brought up)\b([^.?!]*)/;

/** Hard codes for what Dr. Lee wrote. `said` is everything the user gave: their turns and their plan. */
export function clinicianRuleCodes(say: string, said: readonly string[]): GuardCode[] {
  const own = withoutFixedLines(say);
  const have = allStems(said.join("\n"));
  const codes: GuardCode[] = [];
  for (const sentence of splitSentences(own)) {
    const t = normalizeText(sentence).toLowerCase().replace(/[’‘]/g, "'");
    const question = isQuestion(sentence);
    if (harmWording(sentence)) codes.push("invented_specific");
    if (ROLE.test(t)) codes.push("claims_human");
    if (PRESCRIBE.test(t) || ORDER.test(t) || (!question && IMPERATIVE.test(t))) codes.push("advice_treatment");
    if (LEAK.test(t)) codes.push("schema");
    if (ANSWER_FOR.test(t)) codes.push("invented_specific");
    const said1 = YOU_SAID.exec(t);
    if (!question) {
      // What follows "you said" is the user's own claim being repeated back, judged below against what they said.
      if (FINDING.test(said1 === null ? t : t.slice(0, said1.index)) || IMPERSONAL.test(t)) codes.push("clinician_finding");
    }
    // A yes/no question only asks; everything else (a statement, a wh-question that takes a claim for granted) must not add a claim.
    if (!isYesNoQuestion(sentence) && (!question || presupposesClaim(sentence))) codes.push(...inventedClaimCodes(sentence, said));
    if (said1 !== null && contentStems(said1[1]).some((w) => !have.has(w))) codes.push("invented_specific");
  }
  return codes.filter((c, n) => codes.indexOf(c) === n);
}
