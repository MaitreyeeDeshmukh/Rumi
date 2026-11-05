/**
 * The check that makes the recap trustworthy (07 D11). Pure. Nothing the model says is trusted:
 * every item must cite real lines, and EVERY sentence of it must be backed by those lines (content words, numbers,
 * amounts bound to the right medicine, medicine names, diagnoses, and the same yes/no meaning).
 * Rejection is a demotion to a fixed-template line, never a retry.
 * The model writes no free-text "unconfirmed" notes; those lines are made here.
 *
 * KNOWN LIMITS (lexical check, final round of the features lane; each is the safe direction unless noted):
 * - A pronoun's noun must be in a cited line: "The clinician will print the instructions" for "I will print them" is
 *   demoted unless the line that said "instructions" is cited too.
 * - Paraphrases outside the small synonym list in stems.ts and the safe-word list here are demoted.
 * - Negation is counted per sentence (even = positive). Two opposite slips in one sentence cancel out ("Do take it, do
 *   not stop" for "Do not take it, stop").  NOT the safe direction, rare.
 * - An item may drop a modal word ("You must rest" -> "Rest."), and may turn "can" into a plain instruction.
 * - Only the meaning words in NEGATORS, OPPOSITES and the modality lists are checked; a flip made with another word
 *   ("allow" for "forbid") is caught only when the item's own words are not in the line (coverage), not by meaning.
 * - A dose written after a pronoun or "the blue one" is bound to no medicine, so an item that needs it is demoted.
 */
import { lineOverlaps, planStatusFallback, type PlanItemRef } from "@/features/recap/planStatusFallback";
import { claimKeys, harmWording } from "@/features/shared/claims";
import { CONDITIONS } from "@/features/shared/lists";
import { adviceCodes } from "@/lib/ai/guards/output";
import type { GuardCode } from "@/features/shared/guards";
import type { RecapModelOutT } from "@/features/shared/schemas";
import type { PlanStatusEntry, RecapItem, Speaker, TranscriptLine } from "@/features/shared/types";
import { dosesByDrug, ledgerFromTexts, measureUnit, ungroundedSpecifics } from "@/lib/text/specifics";
import { allStems, contentStems, stem } from "@/lib/text/stems";
import { contentWords } from "@/lib/text/tokens";
import { normalizeText, splitSentences } from "@/lib/text/tokens";
import { truncateAtWord } from "@/lib/text/truncate";

export interface VerifiedRecap {
  items: RecapItem[];
  /** Fixed-template lines only. */
  unconfirmed: string[];
  planStatus: PlanStatusEntry[];
  /** Items demoted to unconfirmed. */
  dropped: number;
}

/** Tighter than the reply schema (30 lines of 400) so the rows also fit the database table (10 lines of 300). */
const MAX_UNCONFIRMED = 10;
const MAX_UNCONFIRMED_CHARS = 300;
const PREFIX = "I could not confirm this: ";
const UNCLEAR = /\[\s*unclear\s*\]/i;
/**
 * Ordinary connecting and reporting words an item may use without the line saying them (a paraphrase, not a new fact):
 * "The clinician asked if you have allergies." for "Do you have allergies?". Negators and contraction heads are left out
 * of the coverage count because their meaning is checked by the yes/no parity below.
 */
const SAFE_ABSENT = new Set([
  "next", "again", "also", "soon", "later", "cannot", "don", "doesn", "didn", "won", "shouldn", "mustn", "isn", "aren", "wasn", "couldn",
  "wouldn", "clinician", "doctor", "nurse", "asked", "asks", "said", "told", "mentioned", "answered", "wants", "wondered", "whether",
  "medicine", "medicines", "medication", "medications",
]);
/** Words that say "do not" or flip a meaning. An even count (do NOT SKIP) means the sentence is positive. */
const NEGATORS = new Set([
  "not", "never", "no", "nor", "none", "cannot", "can't", "cant", "don't", "dont", "doesn't", "didn't", "won't", "wont", "shouldn't",
  "mustn't", "isn't", "aren't", "wasn't", "avoid", "stop", "skip", "without", "discontinue", "quit", "refrain", "unless", "except", "unable",
  "fail", "forget", "hesitate", "against", "off", "rarely", "seldom", "hardly", "barely", "scarcely", "few", "neither",
]);
/** The content words of a sentence that the cited lines must back: no measure units (the amount check covers those), no safe words, no negators. */
const needed = (sentence: string): string[] => [
  ...new Set(contentWords(sentence).filter((w) => !SAFE_ABSENT.has(w) && !NEGATORS.has(w) && measureUnit(w) === undefined).map(stem)),
];
/** How many content words of a sentence the lines may leave unsaid: none in a short sentence, one per six words in a long one. */
export const allowedMissing = (count: number): number => (count < 8 ? 0 : Math.floor(count / 6));
/** Clauses that follow these words are judged on their own: every content word of them must be backed. */
const CLAUSE_SPLIT = /\s+(?:and|but|because|caused by|due to|so)\s+/i;
/** Sections that say what the clinician told the user: the user's own words can not be their source. */
const CLINICIAN_SECTIONS = new Set(["instructions", "next_steps", "medications"]);
const CONDITION_LIST = CONDITIONS.filter((c) => c !== "add");

/** The one line a recap may show when nothing at all could be confirmed (so the escape hatch is not an empty recap). */
export const NOTHING_CONFIRMED = `${PREFIX}no clear point was found in this visit text.`;

/** Hard `empty`: a recap with no item and no unconfirmed line says nothing at all. */
export const recapEmptyCodes = (r: { items: readonly unknown[]; unconfirmed: readonly unknown[] }): GuardCode[] =>
  r.items.length === 0 && r.unconfirmed.length === 0 ? ["empty"] : [];

/** Shown when the text of a demoted item is itself advice, a diagnosis, an order or a safety statement: the text is not repeated. */
export const GENERIC_UNCONFIRMED = `${PREFIX}one point from the visit text.`;
const IMPERATIVE =
  /^(?:please\s+)?(?:[\p{L}-]+:\s*)?(?:take|stop|start|increase|decrease|skip|use|try|avoid|drink|eat|call|go|do not|don't|keep|continue|quit|apply|inject|swallow|double|reduce|rest|see|seek|visit|phone|get|stay|limit|exercise|sleep|relax|lie|sit|make sure)\b|\byou (?:should|must|need to|have to|ought to)\b/u;
/** A scan, test or result that "was clear / normal", or "everything is fine": a finding nobody confirmed. */
const REASSURANCE =
  /\b(?:scans?|tests?|results?|x-?rays?|bloodwork|exam|bloods?)\b[^.]*\b(?:clear|normal|abnormal|fine|negative|positive)\b|\b(?:everything|all) (?:is|was|looks|seems|were)\b/u;
/** Classes that say something private or medical about a person. A plain symptom, sleep or illness word is not one: visits are about those. */
const PLAIN_CLASSES = new Set(["sleep", "illness"]);
const sensitiveClaim = (text: string): boolean => [...claimKeys(text)].some((k) => !k.startsWith("symptom:") && !PLAIN_CLASSES.has(k));
const NO_ITEMS = ledgerFromTexts([]);

/**
 * A demoted item is something the model said that no line backs. Its words are shown only if they could not hurt: the
 * advice guard (a dose, a diagnosis, a treatment) with an empty ledger, a condition, self-harm or abuse wording, and an
 * order ("Stop taking ...") all replace the text with the generic line.
 */
function risky(text: string): boolean {
  const t = lower(text);
  return adviceCodes(text, NO_ITEMS).length > 0 || harmWording(text) || sensitiveClaim(text) || IMPERATIVE.test(t) || REASSURANCE.test(t);
}
const fixedLine = (text: string): string => (risky(text) ? GENERIC_UNCONFIRMED : PREFIX + truncateAtWord(text, MAX_UNCONFIRMED_CHARS - PREFIX.length));
const lower = (s: string): string => normalizeText(s).replace(/\p{Cf}/gu, "").replace(/[’‘]/g, "'").toLowerCase();
const words = (s: string): string[] => lower(s).match(/[\p{L}\p{N}'-]+/gu) ?? [];

/** Medicine name: everything before the first colon, taken whole (never split on hyphens). Doses in that part are checked as doses elsewhere. */
function medicationName(text: string): string {
  const colon = text.indexOf(":");
  const head = colon >= 0 ? text.slice(0, colon) : (text.trim().split(/\s+/)[0] ?? "");
  return head.replace(/\d[\d.,]*\s*[\p{L}%]*/gu, " ").replace(/\s+/g, " ").replace(/[.,;]+$/, "").trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = lower(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}-])${escaped}(?![\\p{L}\\p{N}-])`, "u").test(lower(haystack).replace(/[^\p{L}\p{N}'-]+/gu, " "));
}

/**
 * "Do not skip your pills" is plain advice to take them: the two negators cancel, but the verb would otherwise have to be
 * said by the item. ("Do not forget to X" needs no rule: not + forget cancel in the negator count.)
 * Applied to the item and to the lines alike, before counting negators.
 */
const meaning = (s: string): string =>
  lower(s)
    .replace(/\b(?:do not|don't|dont|never)\s+(?:skip|miss)\b/g, "take")
    // "no longer than three days" is a limit, not a negation; "a few days" is not the negator "few".
    .replace(/\b(?:no|not) (?:longer|more|less|greater|higher|lower|fewer|later|earlier) than\b/g, "limit")
    .replace(/\ba few\b/g, "several");
const NEGATOR_PHRASES = /\b(hold off|stay away from|give up)\b/g;
const negationCount = (sentence: string): number => words(sentence).filter((w) => NEGATORS.has(w)).length + (sentence.match(NEGATOR_PHRASES) ?? []).length;
const OPPOSITES: readonly (readonly [string, string])[] = [
  ["start", "stop"], ["begin", "stop"], ["increase", "decrease"], ["more", "less"], ["before", "after"], ["raise", "lower"],
];
/** "must" and "may" are different promises. Only a disagreement between the two sentences counts; an item may drop the modal word. */
const OBLIGATION = /\b(must|should|shall|ought|have to|has to|need to|needs to)\b/;
const PERMISSION = /\b(may|can|could|might|allowed)\b/;
const modality = (s: string): "must" | "may" | undefined => {
  const must = OBLIGATION.test(s);
  const may = PERMISSION.test(s);
  return must === may ? undefined : must ? "must" : "may";
};
const REPORTING = /\b(asked|asks|asking|wondered|wonders|wants? to know|whether|question)\b/;
const PRONOUN = /\b(?:it|them|they|this|that|these|those|he|she|him|her)\b/;

/** Where a sentence changes direction: "can drive today but not tomorrow". Each clause is judged on its own negation. */
const CLAUSE_BREAK = /;|,|\s+(?:but|and|while|although|though|yet|then)\s+|\s[-–—]\s|[()]/;

/**
 * For every content stem of a sentence, whether it sits in a negated clause (true) or a plain one (false), or both.
 * Moving a "not" to another clause ("drive tomorrow but not today" for "drive today but not tomorrow") keeps the
 * total count of negators, so the whole-sentence parity cannot see it; this does.
 */
function polarity(sentence: string): Map<string, Set<boolean>> {
  const out = new Map<string, Set<boolean>>();
  for (const clause of meaning(sentence).split(CLAUSE_BREAK)) {
    const negated = negationCount(clause) % 2 === 1;
    for (const w of contentWords(clause)) {
      if (NEGATORS.has(w)) continue;
      const key = stem(w);
      const seen = out.get(key) ?? new Set<boolean>();
      seen.add(negated);
      out.set(key, seen);
    }
  }
  return out;
}

/** A word the item puts in a clause with another polarity than every clause of the cited sentence that has it. */
function polarityFlipped(item: string, cited: string): boolean {
  const theirs = polarity(cited);
  for (const [key, mine] of polarity(item)) {
    const said = theirs.get(key);
    if (said !== undefined && [...mine].some((p) => !said.has(p))) return true;
  }
  return false;
}

/** Words whose position in a sentence decides who or what gets what: "instead of", "from X to Y", "before", "more X, less Y". */
const ORDER_MARKERS = new Set(["instead", "rather", "from", "before", "after", "then", "first", "more", "less", "fewer", "than"]);

/** The content stems and order markers of a sentence in the order they first appear. */
function sequence(sentence: string): string[] {
  const content = new Set(contentWords(sentence).filter((w) => !NEGATORS.has(w)).map(stem));
  const out: string[] = [];
  for (const w of words(sentence)) {
    const key = ORDER_MARKERS.has(w) ? w : content.has(stem(w)) ? stem(w) : undefined;
    if (key !== undefined && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Same words, other order. Where the cited sentence has a swap-sensitive marker or more than one clause, the shared
 * stems must come in the same order: "use the inhaler instead of the tablets" is not "use the tablets instead of the inhaler",
 * and "Mom will call and Sam will bring" is not "Sam will call and Mom will bring". A harmless reordering of a plain
 * one-clause sentence is not checked.
 */
function orderSwapped(itemText: string, cited: string): boolean {
  const sensitive = cited.split(CLAUSE_BREAK).length > 1 || words(cited).some((w) => ORDER_MARKERS.has(w));
  if (!sensitive) return false;
  // A medication item starts with its name and a colon ("Ibuprofen: take it ..."); the name is not part of the sentence order.
  const item = itemText.replace(/^[^:]{1,40}:\s*/, "");
  const a = sequence(item);
  const b = sequence(cited);
  return a.filter((x) => b.includes(x)).join(" ") !== b.filter((x) => a.includes(x)).join(" ");
}

/** Quantifiers and restrictors. An item may not add "only", "all", "every", "always"; it may not drop "only"; "some" is not "all". */
const UNIVERSAL = new Set(["only", "all", "every", "always", "everything", "everyone"]);
const QUANTIFIERS = new Set([...UNIVERSAL, "some", "many", "most", "several", "any"]);
function quantifierFlipped(item: string, cited: string): boolean {
  const a = words(item);
  const b = words(cited);
  if (a.some((w) => UNIVERSAL.has(w) && !b.includes(w))) return true;
  if (b.includes("only") && !a.includes("only")) return true;
  const qa = a.filter((w) => QUANTIFIERS.has(w));
  const qb = b.filter((w) => QUANTIFIERS.has(w));
  return qa.length > 0 && qb.length > 0 && !qa.every((w) => qb.includes(w));
}

/** Does the item sentence say something else than the cited sentence: yes/no, opposite word, must/may, question/statement, order? */
export function flipped(itemSentence: string, citedSentence: string): boolean {
  const item = meaning(itemSentence);
  const cited = meaning(citedSentence);
  if (negationCount(item) % 2 !== negationCount(cited) % 2) return true;
  if (polarityFlipped(item, cited) || orderSwapped(item, cited) || quantifierFlipped(item, cited)) return true;
  const a = new Set(words(item));
  const b = new Set(words(cited));
  if (OPPOSITES.some(([x, y]) => (a.has(x) && b.has(y) && !b.has(x)) || (a.has(y) && b.has(x) && !b.has(y)))) return true;
  const [mi, mc] = [modality(item), modality(cited)];
  if (mi && mc && mi !== mc) return true;
  // A question in the lines may be reported ("The clinician asked if ..."), never turned into a statement, or the reverse.
  const asks = citedSentence.trim().endsWith("?");
  return asks ? !(itemSentence.trim().endsWith("?") || REPORTING.test(item)) : itemSentence.trim().endsWith("?");
}

/** How many content words of `a` (not counting negators: those are judged by polarity, not by overlap) the sentence `b` says. */
const overlap = (a: string, b: string): number => {
  const have = allStems(b);
  const skip = new Set(contentWords(a).filter((w) => NEGATORS.has(w)).map(stem));
  return contentStems(a).filter((w) => !skip.has(w) && have.has(w)).length;
};

function supported(item: RecapItem, byId: Map<string, TranscriptLine>, mySpeaker: Speaker): boolean {
  const cited = [...new Set(item.evidence)].map((id) => byId.get(id));
  // No evidence at all is rejected below too: there is nothing for the item to overlap with.
  if (cited.some((l) => !l || UNCLEAR.test(l.text))) return false;
  const lines = cited as TranscriptLine[];
  if (CLINICIAN_SECTIONS.has(item.section) && !lines.some((l) => l.speaker !== mySpeaker)) return false;
  const texts = lines.map((l) => l.text);
  const joined = texts.join(" ");

  // Every sentence of the item must be backed by the cited lines, and mean the same.
  const have = allStems(meaning(joined));
  // The item must say something of its own that a cited line backs (reporting words and negators alone are not content).
  const own = needed(meaning(item.text));
  if (!own.some((w) => have.has(w))) return false;
  const citedSentences = texts.flatMap((t) => splitSentences(t));
  for (const sentence of splitSentences(item.text)) {
    const need = needed(meaning(sentence));
    if (need.filter((w) => !have.has(w)).length > allowedMissing(need.length)) return false;
    // A clause added with and/but/because/caused by must be backed word for word.
    if (sentence.split(CLAUSE_SPLIT).slice(1).some((clause) => needed(meaning(clause)).some((w) => !have.has(w)))) return false;
    // Each clause must come from ONE cited sentence: "Take the blue pill in the morning" is not backed by "Take the blue pill at night"
    // and "Take the red pill in the morning" read together.
    // A sentence with a pronoun ("It has been about three weeks", "I will print them") may lean on the sentence before it.
    for (const clause of meaning(sentence).split(CLAUSE_BREAK)) {
      const need = needed(clause);
      const room = allowedMissing(need.length);
      const covers = citedSentences.some((c, n) => {
        // A pronoun may point at anything said earlier in the cited lines; an answer ("About three times a week.") belongs to the question before it.
        const lean = n > 0 && PRONOUN.test(lower(c)) ? citedSentences.slice(0, n + 1) : n > 0 && citedSentences[n - 1].trim().endsWith("?") ? [citedSentences[n - 1], c] : [c];
        const said = allStems(meaning(lean.join(" ")));
        return need.filter((w) => !said.has(w)).length <= room;
      });
      if (need.length > 0 && !covers) return false;
    }
    // Judge the sentence against EVERY cited sentence that covers the most of it (words that carry no negation), not just one:
    // it is faithful if at least one of them says the same thing.
    const scores = citedSentences.map((c) => overlap(sentence, c));
    const top = Math.max(0, ...scores);
    if (top > 0 && citedSentences.filter((_, n) => scores[n] === top).every((c) => flipped(sentence, c))) return false;
  }

  // A diagnosis the lines never said, even inside an otherwise matching sentence.
  if (CONDITION_LIST.some((c) => containsPhrase(item.text, c) && !containsPhrase(joined, c))) return false;

  const name = item.section === "medications" ? medicationName(item.text) : "";
  if (item.section === "medications" && !containsPhrase(joined, name)) return false;
  if (!ungroundedSpecifics(item.text, ledgerFromTexts(texts)).ok) return false;

  // A dose belongs to the medicine it was said about, not to another one in the same line.
  const extras = name.split(/[^\p{L}]+/u).filter((n) => n.length >= 3);
  const said = new Set(texts.flatMap((t) => [...dosesByDrug(t, extras)]));
  return [...dosesByDrug(item.text, extras)].every((d) => said.has(d));
}

function checkStatus(entry: PlanStatusEntry, item: PlanItemRef, byId: Map<string, TranscriptLine>, mySpeaker: Speaker, fallback: PlanStatusEntry): PlanStatusEntry {
  const { status } = entry;
  // "not_asked" is a claim about the whole transcript: if a line clearly matches the item, the deterministic answer wins.
  if (status === "not_asked") return fallback;
  if (status === "asked_by_me" || status === "asked_by_other") {
    const good = [...new Set(entry.evidence)]
      .map((id) => byId.get(id))
      .filter((l): l is TranscriptLine => !!l && !UNCLEAR.test(l.text) && (status === "asked_by_me") === (l.speaker === mySpeaker) && lineOverlaps(item.text, l.text));
    if (good.length > 0) return { itemId: item.id, status, evidence: good.map((l) => l.id) };
  }
  return { itemId: item.id, status: "unclear", evidence: [] };
}

export function verifyEvidence(lines: readonly TranscriptLine[], raw: RecapModelOutT, mySpeaker: Speaker, plan: readonly PlanItemRef[] = []): VerifiedRecap {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const items: RecapItem[] = [];
  const lost: RecapItem[] = [];
  for (const it of raw.items) (supported(it, byId, mySpeaker) ? items : lost).push(it);
  // The [unclear] notices come first: they are about the visit itself, and the cap must never hide them behind demoted items.
  const unconfirmed = [
    ...lines.filter((l) => UNCLEAR.test(l.text)).map((l) => fixedLine(l.text)),
    ...lost.map((i) => fixedLine(i.text)),
  ];

  const fallback = planStatusFallback(lines, mySpeaker, plan);
  const planStatus = plan.map((item, n): PlanStatusEntry => {
    const checked = raw.planStatus.filter((p) => p.itemId === item.id).map((p) => checkStatus(p, item, byId, mySpeaker, fallback[n]));
    if (checked.length === 0) return fallback[n];
    return checked.every((c) => c.status === checked[0].status) ? checked[0] : { itemId: item.id, status: "unclear", evidence: [] };
  });

  return { items, unconfirmed: [...new Set(unconfirmed)].slice(0, MAX_UNCONFIRMED), planStatus, dropped: lost.length };
}

