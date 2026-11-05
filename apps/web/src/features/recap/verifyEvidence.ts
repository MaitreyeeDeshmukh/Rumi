/**
 * The check that makes the recap trustworthy (07 D11). Pure. Nothing the model says is trusted:
 * every item must cite real lines, share words with them, and carry no number, amount, frequency or medicine
 * that is missing from those lines. Rejection is a demotion to a fixed-template line, never a retry.
 * The model writes no free-text "unconfirmed" notes; those lines are made here.
 */
import { lineOverlaps, planStatusFallback, type PlanItemRef } from "@/features/recap/planStatusFallback";
import type { GuardCode } from "@/features/shared/guards";
import type { RecapModelOutT } from "@/features/shared/schemas";
import type { PlanStatusEntry, RecapItem, Speaker, TranscriptLine } from "@/features/shared/types";
import { COMMON_DRUGS, toSet } from "@/features/shared/lists";
import { ledgerFromTexts, ungroundedSpecifics } from "@/lib/text/specifics";
import { normalizeText } from "@/lib/text/tokens";
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
const DRUGS = toSet(COMMON_DRUGS);
const NEGATION = new Set(["not", "never", "avoid", "stop", "dont", "don't", "no", "without", "shouldn't", "mustn't", "cannot", "can't"]);

/** The one line a recap may show when nothing at all could be confirmed (so the escape hatch is not an empty recap). */
export const NOTHING_CONFIRMED = `${PREFIX}no clear point was found in this visit text.`;

/** Hard `empty`: a recap with no item and no unconfirmed line says nothing at all. */
export const recapEmptyCodes = (r: { items: readonly unknown[]; unconfirmed: readonly unknown[] }): GuardCode[] =>
  r.items.length === 0 && r.unconfirmed.length === 0 ? ["empty"] : [];

const fixedLine = (text: string): string => PREFIX + truncateAtWord(text, MAX_UNCONFIRMED_CHARS - PREFIX.length);
const lower = (s: string): string => normalizeText(s).replace(/\p{Cf}/gu, "").replace(/[’‘]/g, "'").toLowerCase();

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

const words = (sentence: string): string[] => lower(sentence).match(/[\p{L}\p{N}'-]+/gu) ?? [];

/** Is a negation word within four words before, or three after, the medicine, in the same sentence? */
function negatesDrug(text: string, drug: string): boolean {
  return lower(text)
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => {
      const w = words(sentence);
      return w.some((token, i) => token === drug && w.slice(Math.max(0, i - 4), i).concat(w.slice(i + 1, i + 4)).some((x) => NEGATION.has(x)));
    });
}

const hasNegation = (text: string): boolean => words(text).some((w) => NEGATION.has(w));

function supported(item: RecapItem, byId: Map<string, TranscriptLine>): boolean {
  const cited = [...new Set(item.evidence)].map((id) => byId.get(id));
  // No evidence at all is rejected below too: there is nothing for the item to overlap with.
  if (cited.some((l) => !l || UNCLEAR.test(l.text))) return false;
  const texts = (cited as TranscriptLine[]).map((l) => l.text);
  const joined = texts.join(" ");
  if (!lineOverlaps(item.text, joined)) return false;
  const name = item.section === "medications" ? medicationName(item.text) : "";
  if (item.section === "medications" && !containsPhrase(joined, name)) return false;
  if (!ungroundedSpecifics(item.text, ledgerFromTexts(texts)).ok) return false;
  const drugs = new Set(words(item.text).filter((w) => DRUGS.has(w)));
  if (name) drugs.add(lower(name).split(" ")[0]);
  return [...drugs].every((drug) => {
    const lineNegates = texts.some((t) => negatesDrug(t, drug));
    return lineNegates ? hasNegation(item.text) : !negatesDrug(item.text, drug);
  });
}

function checkStatus(entry: PlanStatusEntry, item: PlanItemRef, byId: Map<string, TranscriptLine>, mySpeaker: Speaker): PlanStatusEntry {
  const { status } = entry;
  if (status === "asked_by_me" || status === "asked_by_other") {
    const good = [...new Set(entry.evidence)]
      .map((id) => byId.get(id))
      .filter((l): l is TranscriptLine => !!l && !UNCLEAR.test(l.text) && (status === "asked_by_me") === (l.speaker === mySpeaker) && lineOverlaps(item.text, l.text));
    if (good.length > 0) return { itemId: item.id, status, evidence: good.map((l) => l.id) };
  }
  return { itemId: item.id, status: status === "not_asked" ? "not_asked" : "unclear", evidence: [] };
}

export function verifyEvidence(lines: readonly TranscriptLine[], raw: RecapModelOutT, mySpeaker: Speaker, plan: readonly PlanItemRef[] = []): VerifiedRecap {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const items: RecapItem[] = [];
  const lost: RecapItem[] = [];
  for (const it of raw.items) (supported(it, byId) ? items : lost).push(it);
  const unconfirmed = [
    ...lost.map((i) => fixedLine(i.text)),
    ...lines.filter((l) => UNCLEAR.test(l.text)).map((l) => fixedLine(l.text)),
  ];

  const fallback = planStatusFallback(lines, mySpeaker, plan);
  const planStatus = plan.map((item, n): PlanStatusEntry => {
    const checked = raw.planStatus.filter((p) => p.itemId === item.id).map((p) => checkStatus(p, item, byId, mySpeaker));
    if (checked.length === 0) return fallback[n];
    return checked.every((c) => c.status === checked[0].status) ? checked[0] : { itemId: item.id, status: "unclear", evidence: [] };
  });

  return { items, unconfirmed: [...new Set(unconfirmed)].slice(0, MAX_UNCONFIRMED), planStatus, dropped: lost.length };
}
