/**
 * The check that makes the recap trustworthy (07 D11). Pure. Nothing the model says is trusted:
 * every item must cite real lines, and EVERY sentence of it must be backed by those lines (content words, numbers,
 * amounts bound to the right medicine, medicine names, diagnoses, and the same yes/no meaning).
 * Rejection is a demotion to a fixed-template line, never a retry.
 * The model writes no free-text "unconfirmed" notes; those lines are made here.
 */
import { lineOverlaps, planStatusFallback, type PlanItemRef } from "@/features/recap/planStatusFallback";
import { CONDITIONS } from "@/features/shared/lists";
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
/** Each sentence of an item must have at least this share of its content words in the cited lines. */
const SENTENCE_COVERAGE = 0.75;
/**
 * Ordinary connecting words an item may use without the line saying them (a paraphrase, not a new fact), and negators and
 * contraction heads (their meaning is checked by the yes/no parity, so "Never skip" may stand for "Do not skip").
 */
const SAFE_ABSENT = new Set([
  "next", "again", "also", "soon", "later", "never", "none", "without", "cannot", "nor", "don", "doesn", "didn", "won", "shouldn", "mustn",
  "isn", "aren", "wasn", "couldn", "wouldn",
]);
/** The content words of a sentence that the cited lines must back: no measure units (the amount check covers those), no safe words. */
const needed = (sentence: string): string[] => [
  ...new Set(contentWords(sentence).filter((w) => !SAFE_ABSENT.has(w) && measureUnit(w) === undefined).map(stem)),
];
/** Sections that say what the clinician told the user: the user's own words can not be their source. */
const CLINICIAN_SECTIONS = new Set(["instructions", "next_steps", "medications"]);
const CONDITION_LIST = CONDITIONS.filter((c) => c !== "add");

/** The one line a recap may show when nothing at all could be confirmed (so the escape hatch is not an empty recap). */
export const NOTHING_CONFIRMED = `${PREFIX}no clear point was found in this visit text.`;

/** Hard `empty`: a recap with no item and no unconfirmed line says nothing at all. */
export const recapEmptyCodes = (r: { items: readonly unknown[]; unconfirmed: readonly unknown[] }): GuardCode[] =>
  r.items.length === 0 && r.unconfirmed.length === 0 ? ["empty"] : [];

const fixedLine = (text: string): string => PREFIX + truncateAtWord(text, MAX_UNCONFIRMED_CHARS - PREFIX.length);
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

/** Words that say "do not" or flip a meaning. An even count (do NOT SKIP) means the sentence is positive. */
const NEGATORS = new Set([
  "not", "never", "no", "nor", "none", "cannot", "can't", "cant", "don't", "dont", "doesn't", "didn't", "won't", "wont", "shouldn't",
  "mustn't", "isn't", "aren't", "wasn't", "avoid", "stop", "skip", "without", "discontinue", "quit",
]);
const NEGATOR_PHRASES = /\b(hold off|stay away from|give up)\b/g;
const negationCount = (sentence: string): number =>
  words(sentence).filter((w) => NEGATORS.has(w)).length + (lower(sentence).match(NEGATOR_PHRASES) ?? []).length;
const OPPOSITES: readonly (readonly [string, string])[] = [
  ["start", "stop"], ["begin", "stop"], ["increase", "decrease"], ["more", "less"], ["before", "after"], ["raise", "lower"],
];

function flipped(itemSentence: string, citedSentence: string): boolean {
  if (negationCount(itemSentence) % 2 !== negationCount(citedSentence) % 2) return true;
  const a = new Set(words(itemSentence));
  const b = new Set(words(citedSentence));
  return OPPOSITES.some(([x, y]) => (a.has(x) && b.has(y) && !b.has(x)) || (a.has(y) && b.has(x) && !b.has(y)));
}

const overlap = (a: string, b: string): number => {
  const have = allStems(b);
  return contentStems(a).filter((w) => have.has(w)).length;
};

function supported(item: RecapItem, byId: Map<string, TranscriptLine>, mySpeaker: Speaker): boolean {
  const cited = [...new Set(item.evidence)].map((id) => byId.get(id));
  // No evidence at all is rejected below too: there is nothing for the item to overlap with.
  if (cited.some((l) => !l || UNCLEAR.test(l.text))) return false;
  const lines = cited as TranscriptLine[];
  if (CLINICIAN_SECTIONS.has(item.section) && !lines.some((l) => l.speaker !== mySpeaker)) return false;
  const texts = lines.map((l) => l.text);
  const joined = texts.join(" ");
  if (!lineOverlaps(item.text, joined)) return false;

  // Every sentence of the item must be backed by the cited lines, and mean the same (yes or no).
  const have = allStems(joined);
  const citedSentences = texts.flatMap((t) => splitSentences(t));
  for (const sentence of splitSentences(item.text)) {
    const need = needed(sentence);
    if (need.length > 0 && need.filter((w) => have.has(w)).length < Math.ceil(need.length * SENTENCE_COVERAGE)) return false;
    let best = citedSentences[0];
    let bestScore = -1;
    for (const c of citedSentences) {
      const score = overlap(sentence, c);
      if (score > bestScore) [best, bestScore] = [c, score];
    }
    if (best !== undefined && bestScore > 0 && flipped(sentence, best)) return false;
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
  const unconfirmed = [
    ...lost.map((i) => fixedLine(i.text)),
    ...lines.filter((l) => UNCLEAR.test(l.text)).map((l) => fixedLine(l.text)),
  ];

  const fallback = planStatusFallback(lines, mySpeaker, plan);
  const planStatus = plan.map((item, n): PlanStatusEntry => {
    const checked = raw.planStatus.filter((p) => p.itemId === item.id).map((p) => checkStatus(p, item, byId, mySpeaker, fallback[n]));
    if (checked.length === 0) return fallback[n];
    return checked.every((c) => c.status === checked[0].status) ? checked[0] : { itemId: item.id, status: "unclear", evidence: [] };
  });

  return { items, unconfirmed: [...new Set(unconfirmed)].slice(0, MAX_UNCONFIRMED), planStatus, dropped: lost.length };
}

