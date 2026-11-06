/**
 * Grounding check (07 D8, D9): a "specific" is a number, an amount, a time, a name or a medicine.
 * Output may only contain specifics that some ledger text also contains, compared as WHOLE TOKENS
 * (no substring tests: 3 is not 13, Lee is not Leeds) and amounts as (number, unit) pairs.
 * Blanks like "[how many days]" are the escape hatch, so they are removed before the scan and judged separately;
 * `validateGrounding` runs both so a smuggled blank can not be forgotten.
 */
import type { GuardCode } from "@/features/shared/guards";
import { COMMON_DRUGS, MONTHS, NUMBER_WORDS, RELATIVE_TIME, SENTENCE_STARTERS, STOPWORDS, UNITS, WEEKDAYS, toSet } from "@/features/shared/lists";
import type { EvidenceLedger } from "@/features/shared/task";
import { normalizeText, splitSentences, wordList } from "@/lib/text/tokens";

export interface SpecificsResult {
  ok: boolean;
  /** The ungrounded tokens, as written. For tests and the eval scorer only. Callers that log use specificsCodes. */
  tokens: string[];
}

const MONTH_SET = toSet(MONTHS);
const WEEKDAY_SET = toSet(WEEKDAYS);
const DRUG_SET: ReadonlySet<string> = new Set<string>(COMMON_DRUGS);
const STOP = toSet(STOPWORDS);
export const isDrugWord = (w: string): boolean => DRUG_SET.has(w.toLowerCase());
const NUMBER_WORD_SET = toSet(NUMBER_WORDS);
/** Spelled-out units the shared list lacks. Each maps to the same canonical unit as its symbol (UNIT_CANON). */
const EXTRA_UNITS = [
  "milligram", "milligrams", "microgram", "micrograms", "gram", "grams", "kilogram", "kilograms", "millilitre", "millilitres",
  "milliliter", "milliliters", "litre", "litres", "liter", "liters", "ounce", "ounces", "oz", "pound", "pounds", "lb", "lbs", "cc",
  "percent", "degree", "degrees",
];
const UNIT_SET = new Set([...UNITS, ...EXTRA_UNITS].map((u) => normalizeText(u).toLowerCase()));
/** Units that may follow a number WORD ("two weeks"). Letters and suffixes like pm/rd are excluded: "ten l" is not a claim. */
const WORD_UNIT_SET = new Set([...UNIT_SET].filter((u) => !["x", "g", "l", "st", "nd", "rd", "th", "am", "pm", "%", "oz", "lb", "lbs", "cc"].includes(u)));

const KEEP = new Set(["i", "rumi"]);
/** Pronouns and place words that start a sentence with a verb after them ("She asked ...") without being a person's name. */
const NOT_NAMES = new Set(["doctors", "nurses", "doctor", "nurse", "clinician", "clinicians", "staff", "patients", "others", "he", "she", "they", "we", "you", "it", "there", "here", "everyone", "someone", "nobody", "somebody", "anyone", "people", "one"]);
const STARTERS = toSet(SENTENCE_STARTERS);
/** Characters after which a word begins a new clause, like a sentence start: "I want to ask: Why ...", "Hello, Thank you", She asked, "Why ...". */
const CLAUSE_OPENERS = new Set([":", ",", '"', "“", "‘", "(", "["]);
/** Proper words the app itself uses ("Dr. Lee", the "Help me say it" button, "Hello, Doctor"). */
const KNOWN_CAPITALS = new Set(["lee", "help", "doctor", "nurse"]);
/** A sentence that starts with an unknown capitalised word followed by one of these is a person doing something ("Patel told me to rest."). */
const REPORT_VERBS = new Set([
  "told", "tells", "said", "says", "asked", "asks", "gave", "gives", "hit", "hits", "shouts", "shouted", "yells", "yelled",
  "follows", "followed", "called", "calls", "wants", "wanted", "thinks", "thought", "saw", "sees", "prescribed", "diagnosed",
  "referred", "noticed", "mentioned", "wrote", "writes", "sent", "laughs", "laughed",
]);
const TITLES = new Set(["dr", "mr", "mrs", "ms", "prof"]);
const CAPS_OK = new Set(["I", "AI", "OK", "US"]);
/** Months that are also ordinary words: counted only when capitalised and not at the start of a sentence. */
const AMBIGUOUS_MONTHS = new Set(["may", "march"]);
/** Relatives, carers and other people: inventing one ("Mom hits me") invents a fact about the user's life. */
const PERSON_WORDS = new Set([
  "mom", "mum", "mother", "dad", "father", "parent", "parents", "sister", "brother", "wife", "husband", "partner",
  "boyfriend", "girlfriend", "son", "daughter", "grandma", "grandmother", "grandpa", "grandfather", "aunt", "uncle",
  "cousin", "roommate", "boss", "teacher", "friend", "friends", "carer", "caregiver", "neighbour", "neighbor", "neighbours",
  "neighbors", "ex", "kid", "kids", "baby", "child", "children", "nana", "gran", "granny", "nan", "therapist", "manager",
  "coach", "landlord", "stranger", "guardian", "nanny", "sibling", "siblings", "relative", "relatives", "family", "colleague",
  "coworker", "classmate", "stepmother", "stepfather", "stepmom", "stepdad", "fiance", "fiancee", "spouse",
]);
/** Ordinal words (not "first", which is ordinary). They are claims like "4th". "second" counts only after "the": "a second" is a moment. */
const ORDINALS: Record<string, string> = {
  second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10",
  eleventh: "11", twelfth: "12", thirteenth: "13", fourteenth: "14", fifteenth: "15", twentieth: "20", thirtieth: "30",
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
/** "twenty-one" is 21, not twenty and one. */
const COMPOUND = new RegExp(`\\b(${Object.keys(TENS).join("|")})[-\\s](${Object.keys(ONES).join("|")})\\b`, "giu");
/** "a few days", "several weeks", "a million": vague amounts are still amounts. */
const VAGUE = /(?<!\p{L})(?:(?:a couple of|a couple|a few|several)\s+(?:days?|weeks?|months?|years?|hours?|minutes?|times?)|a (?:million|billion|trillion))(?!\p{L})/giu;
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
  milligram: "mg", milligrams: "mg", microgram: "mcg", micrograms: "mcg", "μg": "mcg", ug: "mcg", gram: "g", grams: "g",
  kilogram: "kg", kilograms: "kg", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml", cc: "ml",
  litre: "l", litres: "l", liter: "l", liters: "l", ounce: "oz", ounces: "oz", pound: "lb", pounds: "lb", lbs: "lb",
  percent: "%", degrees: "degree", st: "ord", nd: "ord", rd: "ord", th: "ord",
};
const canonUnit = (u: string): string => UNIT_CANON[u] ?? u;
const CALENDAR_UNITS = new Set(["day", "week", "month", "year"]);

/** Cyrillic and Greek letters that look like Latin ones. Only words that MIX scripts are folded, so real Greek or Russian names stay. */
const CONFUSABLE: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ѕ": "s", "ј": "j", "ԁ": "d", "һ": "h", "ɡ": "g",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I",
  "ο": "o", "ν": "v", "ι": "i", "κ": "k", "ρ": "p", "τ": "t", "α": "a", "υ": "u", "ε": "e",
  "Α": "A", "Β": "B", "Ε": "E", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X", "Υ": "Y", "Ζ": "Z",
};
const foldMixed = (s: string): string =>
  s.replace(/[\p{L}\p{M}]+/gu, (w) =>
    /\p{Script=Latin}/u.test(w) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(w) ? [...w].map((ch) => CONFUSABLE[ch] ?? ch).join("") : w,
  );

const prep = (s: string): string =>
  foldMixed(normalizeText(s).replace(/\p{Cf}/gu, "").replace(/[’‘]/g, "'")).replace(COMPOUND, (_m, t: string, o: string) =>
    String(TENS[t.toLowerCase()] + ONES[o.toLowerCase()]),
  );
const BLANK_RE = /\[[^[\]]*\]/g;
const DATE = /(?<!\d)(\d{1,4})\/(\d{1,2})(?:\/(\d{1,4}))?(?!\d)/g;
/** Words before a person word that make it a general idea ("a friend", "your family"), not a claim about the user's life. */
const GENERIC_BEFORE = new Set(["a", "an", "any", "another", "your", "some", "one", "each", "every", "no"]);
const FAMILY_TERMS = new Set(["history", "doctor", "medicine", "practice", "planning", "member", "members"]);
const TOKEN = /(\p{Nd}+(?:[.,]\p{Nd}+)*)([\p{L}\p{M}%]*)|([\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)?)/gu;
const canonNumber = (n: string): string => n.replace(/,(?=\d{3}(?:\D|$))/g, "");

interface Claim {
  /** The key the ledger must contain. */
  need: string;
  /** Every key this text contributes when it is the ledger. */
  keys: string[];
  raw: string;
  /** Index of the sentence this claim came from (phrases: -1). */
  sentence: number;
  /** Set for a medicine word, and for an amount: used to bind doses to medicines. */
  drug?: string;
  amount?: string;
}

const amount = (value: string, unit: string, raw: string, sentence: number): Claim => {
  const u = canonUnit(unit);
  const need = `a:${value}|${u}`;
  const keys = [need, `n:${value}`];
  if (value === "1" && CALENDAR_UNITS.has(u)) keys.push(`p:a ${u}`);
  return { need, keys, raw, sentence, amount: need };
};
const word = (lower: string, raw: string, sentence: number): Claim => ({ need: `w:${lower}`, keys: [`w:${lower}`], raw, sentence });

interface ScannedSentence {
  text: string;
  /** In token order. */
  claims: Claim[];
  phrases: Claim[];
}

function scanSentences(text: string, extraDrugs: ReadonlySet<string> = new Set()): ScannedSentence[] {
  return splitSentences(prep(text).replace(BLANK_RE, " ")).map((sentence, si) => {
    const claims: Claim[] = [];
    const phrases: Claim[] = [];
    const toks = [...sentence.matchAll(TOKEN)];
    const nextWord = (i: number, from: number, units: ReadonlySet<string>): RegExpMatchArray | undefined => {
      const n = toks[i + 1];
      if (!n || n[3] === undefined || !/^\s+$/.test(sentence.slice(from, n.index))) return undefined;
      return units.has(n[3].toLowerCase()) ? n : undefined;
    };
    const skip = new Set<number>();
    const unitAmount = (value: string, i: number, from: number, start: number, units: ReadonlySet<string>): Claim | undefined => {
      const unit = nextWord(i, from, units);
      if (!unit) return undefined;
      skip.add(i + 1);
      return amount(value, unit[3].toLowerCase(), sentence.slice(start, (unit.index ?? 0) + unit[0].length), si);
    };
    toks.forEach((m, i) => {
      if (skip.has(i)) return;
      const start = m.index ?? 0;
      if (m[1] !== undefined) {
        const value = canonNumber(m[1]);
        const suffix = m[2].toLowerCase();
        if (suffix && UNIT_SET.has(suffix)) return void claims.push(amount(value, suffix, m[0], si));
        const spaced = suffix ? undefined : unitAmount(value, i, start + m[0].length, start, UNIT_SET);
        return void claims.push(spaced ?? { need: `n:${value}`, keys: [`n:${value}`], raw: m[0], sentence: si });
      }
      const raw = m[3];
      const base = raw.split("'")[0];
      const lower = base.toLowerCase();
      const capital = /^\p{Lu}/u.test(base);
      if (lower in TIMES) return void claims.push(amount(TIMES[lower], "time", raw, si));
      if (lower === "one") {
        // "one week" is a duration; a bare "one" ("one question at a time", "no one") is ordinary.
        const one = unitAmount("1", i, start + raw.length, start, WORD_UNIT_SET);
        if (one) return void claims.push(one);
      }
      if (NUMBER_WORD_SET.has(lower)) {
        const value = VALUE[lower] ?? lower;
        const withUnit = unitAmount(value, i, start + raw.length, start, WORD_UNIT_SET);
        return void claims.push(withUnit ?? { need: `n:${value}`, keys: [`n:${value}`], raw, sentence: si });
      }
      if (lower in ORDINALS && (lower !== "second" || toks[i - 1]?.[3]?.toLowerCase() === "the")) {
        return void claims.push(amount(ORDINALS[lower], "ord", raw, si));
      }
      // A word that still mixes Latin with Cyrillic or Greek after folding the look-alikes is an attempt to hide something.
      if (/\p{Script=Latin}/u.test(raw) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(raw)) return void claims.push(word(lower, raw, si));
      const month = MONTH_SET.has(lower) && (!AMBIGUOUS_MONTHS.has(lower) || (capital && i > 0));
      if (DRUG_SET.has(lower) || extraDrugs.has(lower)) return void claims.push({ ...word(lower, raw, si), drug: lower });
      if (WEEKDAY_SET.has(lower) || month) return void claims.push(word(lower, raw, si));
      if (PERSON_WORDS.has(lower)) {
        // "a friend", "your family" are asks and "ex-smoker", "family history" are not people; "my kid", "Mom hits me" are claims.
        const prev = toks[i - 1]?.[3]?.toLowerCase();
        const generic = (prev !== undefined && GENERIC_BEFORE.has(prev)) || sentence[start + raw.length] === "-" || (lower === "family" && FAMILY_TERMS.has(toks[i + 1]?.[3]?.toLowerCase() ?? ""));
        if (!generic) return void claims.push(word(lower, raw, si));
        return;
      }
      if (base.length >= 2 && base === base.toUpperCase() && base !== base.toLowerCase() && !CAPS_OK.has(base)) return void claims.push(word(lower, raw, si));
      if (!capital || KEEP.has(lower) || TITLES.has(lower) || CAPS_OK.has(base) || KNOWN_CAPITALS.has(lower)) return;
      const opener = sentence.slice(0, start).trimEnd().slice(-1);
      const clauseStart = STARTERS.has(lower) && CLAUSE_OPENERS.has(opener);
      const nameThenVerb = i === 0 && !STARTERS.has(lower) && !NOT_NAMES.has(lower) && REPORT_VERBS.has(toks[1]?.[3]?.toLowerCase() ?? "");
      if ((i > 0 && !clauseStart) || nameThenVerb) claims.push(word(lower, raw, si));
    });
    const flat = sentence.toLowerCase().replace(/[^\p{L}]+/gu, " ");
    for (const p of PHRASES) {
      if (!new RegExp(`(?<!\\p{L})${p}(?!\\p{L})`, "u").test(flat)) continue;
      const one = /^a (day|week|month|year)$/.exec(p);
      phrases.push({ need: `p:${p}`, keys: one ? [`p:${p}`, `a:1|${one[1]}`] : [`p:${p}`], raw: p, sentence: -1 });
    }
    for (const v of flat.matchAll(VAGUE)) phrases.push({ need: `v:${v[0].trim()}`, keys: [`v:${v[0].trim()}`], raw: v[0].trim(), sentence: -1 });
    // Dates keep their order: 5/11 is not 11/5.
    for (const d of sentence.matchAll(DATE)) {
      const key = [d[1], d[2], d[3]].filter(Boolean).map(canonNumber).join("/");
      phrases.push({ need: `d:${key}`, keys: [`d:${key}`], raw: d[0], sentence: -1 });
    }
    return { text: sentence, claims, phrases };
  });
}

const scan = (text: string, extraDrugs?: ReadonlySet<string>): Claim[] => {
  const all = scanSentences(text, extraDrugs);
  return [...all.flatMap((s) => s.claims), ...all.flatMap((s) => s.phrases)];
};

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

/** Words that sit before a dose without being a medicine name ("Take 5 mg", "Dose 5 mg", "only 5 mg"). */
const DOSE_WORDS = new Set([
  "take", "takes", "taking", "dose", "doses", "give", "gives", "given", "daily", "tablet", "tablets", "pill", "pills", "capsule",
  "capsules", "about", "around", "another", "extra", "only", "maximum", "minimum", "total", "every", "each", "twice", "once",
  "thrice", "medicine", "medication", "drug", "drugs", "dosage", "within", "after", "before", "until",
]);
const isNameCandidate = (w: string): boolean =>
  /^\p{L}{4,}$/u.test(w) && !isDrugWord(w) && !STOP.has(w) && !DOSE_WORDS.has(w) && !UNIT_SET.has(w) && !NUMBER_WORD_SET.has(w) && !MONTH_SET.has(w) && !WEEKDAY_SET.has(w);

interface DoseItem {
  drug?: string;
  amount?: string;
  at: number;
  end: number;
}

/**
 * Doses bound to medicines: "drug|amount" pairs, bound by position, one rule for every amount:
 * 1. "5 mg of warfarin", "5 mg for warfarin": the medicine right after "of/for" owns the amount.
 * 2. Otherwise the nearest medicine BEFORE it ("warfarin 5 mg"), unless another amount sits between them (then it is unbound).
 * 3. With no medicine before: the nearest one after it ("Take 400 mg ibuprofen"), with no other amount between.
 * 4. With no medicine in the sentence at all: the last medicine of an earlier sentence.
 * An unbound amount supports no pair, so an item that needs it is demoted (ambiguity means demotion).
 * A word that sits next to a dose amount and is not an ordinary word ("Quillan 10 mg", "5 mg of Zorbex") counts as a
 * medicine too, so an unlisted second medicine can not lend its dose to the first. `extraNames` are medicine names the
 * lists do not know (the name taken from a "Name: details" item).
 * KNOWN LIMIT: a medicine written in a way none of this sees ("the blue one", "it") owns nothing.
 */
export function dosesByDrug(text: string, extraNames: readonly string[] = []): Set<string> {
  const extras = new Set(extraNames.map((n) => n.toLowerCase()));
  const out = new Set<string>();
  let last: string | undefined;
  for (const { text: s, claims } of scanSentences(text, extras)) {
    const items: DoseItem[] = [];
    let cursor = 0;
    for (const c of claims) {
      if (!c.drug && !c.amount) continue;
      const at = s.indexOf(c.raw, cursor);
      if (at < 0) continue;
      cursor = at + c.raw.length;
      items.push({ drug: c.drug, amount: c.amount, at, end: cursor });
    }
    const candidate = (word: string, at: number): void => {
      const w = word.toLowerCase();
      if (isNameCandidate(w) && !extras.has(w) && !items.some((x) => x.drug && x.at === at)) items.push({ drug: w, at, end: at + word.length });
    };
    for (const a of [...items]) {
      if (!a.amount || measureUnit(a.amount.split("|")[1]) === undefined) continue;
      const before = /(\p{L}+)\s+$/u.exec(s.slice(0, a.at));
      if (before) candidate(before[1], a.at - before[0].length);
      const after = /^(\s+(?:of|for)\s+(?:the\s+)?)(\p{L}+)/u.exec(s.slice(a.end));
      if (after) candidate(after[2], a.end + after[1].length);
    }
    items.sort((x, y) => x.at - y.at);
    items.forEach((a, i) => {
      if (!a.amount) return;
      const prevIdx = items.findLastIndex((x, k) => k < i && x.drug);
      const nextIdx = items.findIndex((x, k) => k > i && x.drug);
      const clear = (from: number, to: number): boolean => !items.slice(from + 1, to).some((x) => x.amount);
      let bound: string | undefined;
      if (nextIdx >= 0 && /^\s*(?:of|for)\s+(?:the\s+)?$/.test(s.slice(a.end, items[nextIdx].at))) bound = items[nextIdx].drug;
      else if (prevIdx >= 0) bound = clear(prevIdx, i) ? items[prevIdx].drug : undefined;
      else if (nextIdx >= 0) bound = clear(i, nextIdx) ? items[nextIdx].drug : undefined;
      else bound = last;
      if (bound) out.add(`${bound}|${a.amount}`);
    });
    last = items.findLast((x) => x.drug)?.drug ?? last;
  }
  return out;
}

/** Dose units ("mg", "milligrams", "ml", "%") by their canonical name; undefined for any other word (days and weeks are not dose units). */
const MEASURE = new Set(["mg", "mcg", "g", "kg", "ml", "l", "oz", "lb", "%", "degree", "unit", "tablet", "pill", "capsule", "puff", "drop"]);
export function measureUnit(word: string): string | undefined {
  const w = normalizeText(word).toLowerCase();
  const u = canonUnit(w);
  return UNIT_SET.has(w) && MEASURE.has(u) ? u : undefined;
}

/** A minimal ledger from plain strings (tests, fallbacks, and the recap check over cited lines). */
export function ledgerFromTexts(texts: readonly string[]): EvidenceLedger {
  return {
    items: texts.map((text, n) => ({ id: `e${n + 1}`, label: `U${n + 1}`, text, source: "user_words" as const })),
    thin: texts.length < 2,
  };
}

const WH = new Set(["what", "how", "when", "which", "where", "who", "why"]);
/**
 * D9: at most 6 words, no digits, no capital after the first character, starts with a question word.
 * Letters, spaces, apostrophes, hyphens, commas and a question mark only, so a blank can not hold a sentence.
 */
const YES_NO_BLANK = /^(?:yes or no|(?:\w+(?: \w+)?) or (?:\w+ )?not(?: \w+)?)$/i;
function validBlank(inner: string): boolean {
  const t = inner.trim();
  // An answer blank for a yes/no question: "yes or no", "do or do not", "am or am not".
  if (YES_NO_BLANK.test(t)) return true;
  if (!t || t.length > 60 || !/^[\p{L}' ,?-]+$/u.test(t) || /\p{Lu}/u.test(t.slice(1))) return false;
  const w = t.split(/\s+/);
  return w.length <= 6 && WH.has(w[0].replace(/[,?]+$/, "").split("'")[0].toLowerCase());
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

/** The one call a spec makes for free text a model wrote: invented specifics and invalid blanks together. */
export function validateGrounding(text: string | readonly string[], ledger: EvidenceLedger): GuardCode[] {
  const texts = typeof text === "string" ? [text] : text;
  return [...specificsCodes(texts, ledger), ...texts.flatMap((t) => blankCodes(t))].filter((c, n, all) => all.indexOf(c) === n);
}
