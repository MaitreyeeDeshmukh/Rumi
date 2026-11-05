/**
 * The evidence ledger: the one list of things that are true for a request (the user's own words, their plan,
 * the transcript). Grounding checks compare model output against it by whole token, never by substring.
 */
import type { EvidenceItem, EvidenceLedger, EvidenceSource } from "@/features/shared/task";
import { LIMITS } from "@/features/shared/constants";
import { normalizeText, splitSentences } from "@/lib/text/tokens";

export interface LedgerSource {
  rawText?: string;
  mainConcern?: string;
  symptoms?: readonly string[];
  /** Enabled plan items in the order the prompt shows them (q1, q2, ...). */
  planItems?: ReadonlyArray<{ text: string }>;
  /** Transcript lines in order (L1, L2, ...). */
  lines?: ReadonlyArray<{ text: string }>;
}

/** Caps for the user's typed words: 40 pieces of at most 300 characters. A long sentence becomes several pieces, never a cut-off one. */
const USER_ITEMS_MAX = 40;
const USER_ITEM_CHARS_MAX = 300;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Splits at word boundaries into pieces of at most `max` characters. A single word longer than `max` is cut. */
function chunk(text: string, max: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const w = word.length > max ? word.slice(0, max) : word;
    if (current === "") current = w;
    else if (current.length + 1 + w.length <= max) current += ` ${w}`;
    else {
      out.push(current);
      current = w;
    }
  }
  if (current !== "") out.push(current);
  return out;
}

export function buildLedger(src: LedgerSource): EvidenceLedger {
  const items: EvidenceItem[] = [];
  const add = (label: string, text: string, source: EvidenceSource): void => {
    items.push({ id: `e${items.length + 1}`, label, text, source });
  };

  // splitSentences cuts at sentence ends and at newlines before any whitespace is collapsed,
  // so a pasted list keeps one entry per line.
  let userSentences = 0;
  let userPieces = 0;
  for (const sentence of splitSentences(src.rawText ?? "").map(collapse).filter(Boolean)) {
    userSentences += 1;
    for (const piece of chunk(sentence, USER_ITEM_CHARS_MAX)) {
      if (userPieces >= USER_ITEMS_MAX) break;
      userPieces += 1;
      add(`U${userPieces}`, piece, "user_words");
    }
  }

  const planText = (s: string, max: number): string => collapse(normalizeText(s)).slice(0, max);
  const concern = planText(src.mainConcern ?? "", LIMITS.concernMax);
  if (concern) add("C1", concern, "plan");
  (src.symptoms ?? []).slice(0, 12).forEach((s, i) => {
    const text = planText(s, 100);
    if (text) add(`S${i + 1}`, text, "plan");
  });
  (src.planItems ?? []).slice(0, LIMITS.planItemsMax).forEach((p, i) => add(`q${i + 1}`, planText(p.text, LIMITS.itemTextMax), "plan"));
  (src.lines ?? []).slice(0, LIMITS.linesMax).forEach((l, i) => add(`L${i + 1}`, planText(l.text, LIMITS.lineTextMax), "transcript"));

  return { items, thin: userSentences < 2 };
}
