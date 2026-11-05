/**
 * Grounding check (07 D8, D9): a "specific" is a number, an amount, a time, a name or a medicine.
 * Output may only contain specifics that some ledger text also contains, compared as WHOLE TOKENS
 * (no substring tests: 3 is not 13, Lee is not Leeds) and amounts as (number, unit) pairs.
 * Blanks like "[how many days]" are the escape hatch, so they are removed before the scan and judged separately.
 */
import type { GuardCode } from "@/features/shared/guards";
import { COMMON_DRUGS, MONTHS, NUMBER_WORDS, RELATIVE_TIME, UNITS, WEEKDAYS, toSet } from "@/features/shared/lists";
import type { EvidenceLedger } from "@/features/shared/task";
import { normalizeText, splitSentences, wordList } from "@/lib/text/tokens";

export interface SpecificsResult {
  ok: boolean;
  /** The ungrounded tokens, as written. For tests and the eval scorer only. Callers that log use specificsCodes. */
  tokens: string[];
}

const MONTH_SET = toSet(MONTHS);
const WEEKDAY_SET = toSet(WEEKDAYS);
const DRUG_SET = toSet(COMMON_DRUGS);
const NUMBER_WORD_SET = toSet(NUMBER_WORDS);
const UNIT_SET = new Set(UNITS.map((u) => normalizeText(u).toLowerCase()));
/** Units that may follow a number WORD ("two weeks"). Letters and suffixes like pm/rd are excluded: "ten l" is not a claim. */
const WORD_UNIT_SET = new Set([...UNIT_SET].filter((u) => !["x", "g", "l", "st", "nd", "rd", "th", "am", "pm", "%"].includes(u)));

const KEEP = new Set(["i", "rumi"]);
const TITLES = new Set(["dr", "mr", "mrs", "ms", "prof"]);
const CAPS_OK = new Set(["I", "AI", "OK", "US"]);
/** Months that are also ordinary words: counted only when capitalised and not at the start of a sentence. */
const AMBIGUOUS_MONTHS = new Set(["may", "march"]);
/** Relatives and carers: inventing one ("Mom hits me") invents a fact about the user's life. */
const PERSON_WORDS = new Set([
  "mom", "mum", "mother", "dad", "father", "parent", "parents", "sister", "brother", "wife", "husband", "partner",
  "boyfriend", "girlfriend", "son", "daughter", "grandma", "grandmother", "grandpa", "grandfather", "aunt", "uncle",
  "cousin", "roommate", "boss", "teacher", "friend", "friends", "carer", "caregiver",
]);
const EXTRA_RELATIVE = ["tomorrow", "tonight", "this morning", "this week", "next week", "this month", "next month", "last time"];
const PHRASES = [...RELATIVE_TIME, ...EXTRA_RELATIVE];

const VALUE: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11",
  twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80",
  ninety: "90", hundred: "100", thousand: "1000", dozen: "12", half: "half",
};
/** "twice" and "2 times" are the same claim. */
const TIMES: Record<string, string> = { once: "1", twice: "2", thrice: "3" };
const UNIT_CANON: Record<string, string> = {
  days: "day", weeks: "week", months: "month", years: "year", hours: "hour", hrs: "hour", hr: "hour", minutes: "minute",
  mins: "minute", min: "minute", seconds: "second", secs: "second", sec: "second", times: "time", x: "time",
  tablets: "tablet", pills: "pill", caps: "capsule", capsules: "capsule", puffs: "puff", drops: "drop", units: "unit",
};
const canonUnit = (u: string): string => UNIT_CANON[u] ?? u;

const prep = (s: string): string => normalizeText(s).replace(/\p{Cf}/gu, "").replace(/[’‘]/g, "'");
const BLANK_RE = /\[[^[\]]*\]/g;
const TOKEN = /(\p{Nd}+(?:[.,]\p{Nd}+)*)([\p{L}\p{M}%]*)|([\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)?)/gu;
const canonNumber = (n: string): string => n.replace(/,(?=\d{3}(?:\D|$))/g, "");

interface Claim {
  /** The key the ledger must contain. */
  need: string;
  /** Every key this text contributes when it is the ledger. */
  keys: string[];
  raw: string;
}

const amount = (value: string, unit: string, raw: string): Claim => {
  const need = `a:${value}|${canonUnit(unit)}`;
  return { need, keys: [need, `n:${value}`], raw };
};
const word = (lower: string, raw: string): Claim => ({ need: `w:${lower}`, keys: [`w:${lower}`], raw });

function scan(text: string): Claim[] {
  const claims: Claim[] = [];
  const phrases: Claim[] = [];
  for (const sentence of splitSentences(prep(text).replace(BLANK_RE, " "))) {
    const toks = [...sentence.matchAll(TOKEN)];
    const nextWord = (i: number, from: number, units: ReadonlySet<string>): RegExpMatchArray | undefined => {
      const n = toks[i + 1];
      if (!n || n[3] === undefined || !/^\s+$/.test(sentence.slice(from, n.index))) return undefined;
      return units.has(n[3].toLowerCase()) ? n : undefined;
    };
    const skip = new Set<number>();
    toks.forEach((m, i) => {
      if (skip.has(i)) return;
      const start = m.index ?? 0;
      if (m[1] !== undefined) {
        const value = canonNumber(m[1]);
        const suffix = m[2].toLowerCase();
        if (suffix && UNIT_SET.has(suffix)) return void claims.push(amount(value, suffix, m[0]));
        const unit = suffix ? undefined : nextWord(i, start + m[0].length, UNIT_SET);
        if (unit) {
          skip.add(i + 1);
          return void claims.push(amount(value, unit[3].toLowerCase(), sentence.slice(start, (unit.index ?? 0) + unit[0].length)));
        }
        return void claims.push({ need: `n:${value}`, keys: [`n:${value}`], raw: m[0] });
      }
      const raw = m[3];
      const base = raw.split("'")[0];
      const lower = base.toLowerCase();
      const capital = /^\p{Lu}/u.test(base);
      if (lower in TIMES) return void claims.push(amount(TIMES[lower], "time", raw));
      if (NUMBER_WORD_SET.has(lower)) {
        const value = VALUE[lower] ?? lower;
        const unit = nextWord(i, start + raw.length, WORD_UNIT_SET);
        if (unit) {
          skip.add(i + 1);
          return void claims.push(amount(value, unit[3].toLowerCase(), sentence.slice(start, (unit.index ?? 0) + unit[0].length)));
        }
        return void claims.push({ need: `n:${value}`, keys: [`n:${value}`], raw });
      }
      const month = MONTH_SET.has(lower) && (!AMBIGUOUS_MONTHS.has(lower) || (capital && i > 0));
      if (WEEKDAY_SET.has(lower) || month || DRUG_SET.has(lower) || PERSON_WORDS.has(lower)) return void claims.push(word(lower, raw));
      if (base.length >= 2 && base === base.toUpperCase() && base !== base.toLowerCase() && !CAPS_OK.has(base)) return void claims.push(word(lower, raw));
      if (i > 0 && capital && !KEEP.has(lower) && !TITLES.has(lower) && !CAPS_OK.has(base)) claims.push(word(lower, raw));
    });
    const flat = sentence.toLowerCase().replace(/[^\p{L}]+/gu, " ");
    for (const p of PHRASES) if (new RegExp(`(?<!\\p{L})${p}(?!\\p{L})`, "u").test(flat)) phrases.push({ need: `p:${p}`, keys: [`p:${p}`], raw: p });
  }
  return [...claims, ...phrases];
}

const ledgerKeys = (ledger: EvidenceLedger): Set<string> => {
  const text = ledger.items.map((i) => i.text).join("\n");
  return new Set([...scan(text).flatMap((c) => c.keys), ...wordList(prep(text)).map((w) => `w:${w}`)]);
};

/** Specifics in `text` that no ledger item contains. Blanks are ignored here; blankCodes judges them. */
export function ungroundedSpecifics(text: string, ledger: EvidenceLedger): SpecificsResult {
  const have = ledgerKeys(ledger);
  const out: string[] = [];
  for (const c of scan(text)) if (!have.has(c.need) && !out.includes(c.raw)) out.push(c.raw);
  return { ok: out.length === 0, tokens: out };
}

/** Guard codes only (never the text), so callers that log cannot leak what the user wrote. */
export function specificsCodes(text: string | readonly string[], ledger: EvidenceLedger): GuardCode[] {
  const texts = typeof text === "string" ? [text] : text;
  return texts.some((t) => !ungroundedSpecifics(t, ledger).ok) ? ["invented_specific"] : [];
}

/** A minimal ledger from plain strings (tests, fallbacks, and the recap check over cited lines). */
export function ledgerFromTexts(texts: readonly string[]): EvidenceLedger {
  return {
    items: texts.map((text, n) => ({ id: `e${n + 1}`, label: `U${n + 1}`, text, source: "user_words" as const })),
    thin: texts.length < 2,
  };
}

const WH = new Set(["what", "how", "when", "which", "where", "who", "why"]);
/** D9: at most 6 words, letters only, no capital after the first character, starts with a question word. */
function validBlank(inner: string): boolean {
  const t = inner.trim();
  if (!t || t.length > 60 || !/^[\p{L}' -]+$/u.test(t) || /\p{Lu}/u.test(t.slice(1))) return false;
  const w = t.split(/\s+/);
  return w.length <= 6 && WH.has(w[0].toLowerCase());
}

/** `invalid_blank` if any bracketed part is not a valid blank, or a bracket is left over (nested or unclosed). */
export function blankCodes(text: string): GuardCode[] {
  let bad = false;
  const rest = prep(text).replace(BLANK_RE, (m) => {
    if (!validBlank(m.slice(1, -1))) bad = true;
    return " ";
  });
  return bad || /[[\]]/.test(rest) ? ["invalid_blank"] : [];
}

/** The text of each valid blank. Only call after blankCodes returned []. */
export function extractBlanks(text: string): string[] {
  return (prep(text).match(BLANK_RE) ?? []).map((m) => m.slice(1, -1).trim()).filter(validBlank);
}
