/**
 * Output guards. They return guard codes only, never text from the output (07 D15, D16).
 * Severity is decided in one place: features/shared/guards.ts.
 *
 * The matching is lexical. It cannot catch a harmful claim built only from ordinary words, and it will
 * sometimes block a harmless sentence; the retry and the deterministic fallback cover both cases.
 */
import { COMMON_DRUGS, CONDITIONS } from "@/features/shared/lists";
import type { GuardCode } from "@/features/shared/guards";
import type { EvidenceLedger } from "@/features/shared/task";
import { extractAmounts, normalizeText, numberTokens, splitSentences } from "@/lib/text/tokens";
import { matchForm, promptForm } from "./input";

// ---------------------------------------------------------------- walking a reply

type SkipKey = (key: string) => boolean;

/** Applies `fn` to every string leaf. Strings under a key for which `skip` is true (ids, enum values) are left alone. */
export function mapStrings<T>(value: T, fn: (s: string) => string, skip: SkipKey = () => false): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return fn(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, skip(k) ? x : walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

export function collectStrings(value: unknown, skip: SkipKey = () => false): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) if (!skip(k)) walk(x);
    }
  };
  walk(value);
  return out;
}

// ---------------------------------------------------------------- URLs

const TLD = "com|org|net|io|gov|edu|app|dev|co|ai|me|ly|xyz|info|test|local|site|online|biz|us|uk";
const URL_PIECES: readonly RegExp[] = [
  /!?\[[^\]]*\]\([^)]*\)/g, // inline link or image
  /!?\[[^\]]*\]\[[^\]]*\]/g, // reference-style link or image
  /^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, // reference definition
  /<\s*(?:https?|ftp|javascript|data|vbscript|file|mailto):[^>]*>/gi, // autolink
  /<\/?(?:a|img|script|iframe|style|link|svg|object|embed|form|input|meta|base)\b[^>]*>/gi,
  /\b(?:https?|ftps?|wss?):\/\/\S*/gi,
  /\b(?:javascript|data|vbscript|file|blob|mailto|tel|sms):\S+/gi,
  /\bwww\.\S+/gi,
  new RegExp(String.raw`\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,4}\.(?:${TLD})\b(?:\/\S*)?`, "gi"),
];

/**
 * Removes links, markdown images and dangerous schemes from free text, to a fixpoint (removing one piece can
 * join two halves into a new link). Run it only over free-text fields, never over ids or enum values.
 * React escapes text, so this is defense in depth against image-URL exfiltration, not the main control.
 */
export function stripUrls(s: string): string {
  let current = promptForm(s);
  for (;;) {
    let next = current;
    for (const re of URL_PIECES) next = next.replace(re, "");
    if (next === current) break;
    current = next;
  }
  return current
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}

// ---------------------------------------------------------------- shared helpers

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternation = (words: readonly string[]): string =>
  [...words].sort((a, b) => b.length - a.length).map((w) => escapeRe(w).replace(/ /g, String.raw`\s+`)).join("|");

/** The text as the guards read it: NFKC, invisible characters and fake tags removed, digits folded. */
const cleanText = (text: string): string => normalizeText(promptForm(text));

interface Sentence {
  /** Lowercase words, apostrophes removed, see matchForm. */
  t: string;
  question: boolean;
}

function sentencesOf(text: string): Sentence[] {
  return splitSentences(cleanText(text)).map((s) => ({ t: matchForm(s).text, question: s.trimEnd().endsWith("?") }));
}

const unique = (codes: GuardCode[]): GuardCode[] => [...new Set(codes)];

// ---------------------------------------------------------------- doses (07 D15)

/** Spoken and written unit names mapped to one canonical unit, so "twenty milligrams" equals "20 mg". */
const DOSE_UNITS: Readonly<Record<string, string>> = {
  mg: "mg", milligram: "mg", milligrams: "mg", milligramme: "mg", milligrammes: "mg",
  mcg: "mcg", µg: "mcg", ug: "mcg", microgram: "mcg", micrograms: "mcg",
  g: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  iu: "iu", unit: "unit", units: "unit",
  puff: "puff", puffs: "puff", drop: "drop", drops: "drop",
  tablet: "tablet", tablets: "tablet", pill: "tablet", pills: "tablet",
  cap: "capsule", caps: "capsule", capsule: "capsule", capsules: "capsule",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  dose: "dose", doses: "dose", patch: "patch", patches: "patch", injection: "injection", injections: "injection",
  spoonful: "spoonful", spoonfuls: "spoonful",
};
const UNIT_ALT = alternation(Object.keys(DOSE_UNITS));

const SMALL: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUM_WORD_ALT = [...Object.keys(SMALL), "hundred", "thousand"].join("|");
// 07 keeps "one" out of the grounding word list because it is too common; a dose still counts "one tablet".
const WORD_AMOUNT = new RegExp(
  String.raw`(?<![\p{L}\d])((?:a\s+(?=hundred|thousand))?(?:${NUM_WORD_ALT})(?:[\s-]+(?:and[\s-]+)?(?:${NUM_WORD_ALT}))*)[\s-]+(${UNIT_ALT})(?![\p{L}\d])`,
  "gu",
);
const HALF_AMOUNT = new RegExp(String.raw`(?<![\p{L}\d])half\s+(?:an?\s+)?(${UNIT_ALT})(?![\p{L}\d])`, "gu");
const DIGIT_LONG_UNIT = new RegExp(String.raw`(?<![\d.,])(\d+(?:[.,]\d+)*)[\s-]*(${UNIT_ALT})(?![\p{L}\d])`, "gu");

function wordsToNumber(words: string): number {
  let total = 0;
  let current = 0;
  for (const w of words.split(/[\s-]+/)) {
    if (w in SMALL) current += SMALL[w];
    else if (w === "hundred") current = (current || 1) * 100;
    else if (w === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    }
  }
  return total + current;
}

/** Every (number, unit) dose pair in the text, as "value|unit" keys. */
function doseKeys(text: string): Set<string> {
  const t = cleanText(text).toLowerCase();
  const keys = new Set<string>();
  const add = (value: string, unit: string): void => {
    const canon = DOSE_UNITS[unit];
    if (canon) keys.add(`${value}|${canon}`);
  };
  for (const a of extractAmounts(t)) add(a.value, a.unit);
  for (const m of t.matchAll(DIGIT_LONG_UNIT)) add(m[1].replace(/,(?=\d{3}(?:\D|$))/g, ""), m[2]);
  for (const m of t.matchAll(WORD_AMOUNT)) add(String(wordsToNumber(m[1])), m[2]);
  for (const m of t.matchAll(HALF_AMOUNT)) add("0.5", m[1]);
  return keys;
}

// ---------------------------------------------------------------- diagnosis and treatment (07 D15)

const COND = alternation(CONDITIONS);
const DRUG = alternation(COMMON_DRUGS);

const NOT_A_GAP_WORD = String.raw`(?:to|been|heard|read|seen|noticed|mentioned|had|tried|asked|said|told)\b`;
const DIAGNOSIS: readonly RegExp[] = [
  new RegExp(
    String.raw`\byou (?:(?:probably|likely|definitely|may|might|could|also|just|seem to|appear to|most likely) )*(?:have|suffer from|are suffering from|are showing signs of|show signs of|are dealing with|are living with)(?:\s+(?!${NOT_A_GAP_WORD})\w+){0,3}?\s+(?:${COND})\b`,
  ),
  new RegExp(String.raw`\byouve got(?:\s+(?!${NOT_A_GAP_WORD})\w+){0,2}?\s+(?:${COND})\b`),
  new RegExp(
    String.raw`\b(?:it is|its|this is|that is|thats|it could be|it might be|it may be|this could be|this might be|that could be|that might be|this sounds like|that sounds like|it sounds like|sounds like|it looks like|this looks like|looks like)(?:\s+(?:probably|likely|definitely|possibly|just|most likely|a|an|some|your))*\s+(?:${COND})\b(?!\s+(?:season|shot|vaccine|vaccination|clinic))`,
  ),
  /\b(?:i|we) (?:diagnose|diagnosed|am diagnosing)\b|\byou (?:are|were|have been) diagnosed\b|\byouve been diagnosed\b|\b(?:the|your) diagnosis (?:is|was)\b/,
];

const TARGET = String.raw`(?:${DRUG}|tablets?|pills?|capsules?|medicines?|medications?|meds|insulin|painkillers?|antibiotics?|supplements?|vitamins?|dosages?|doses?|prescriptions?|antidepressants?|sedatives?|steroids?|inhalers?)`;
const VERB = String.raw`(?:take|try|use|start|stop|increase|decrease|skip|swap|switch to|double|halve|add|drink|apply|inject|swallow)`;
const LEAD = String.raw`(?:please|then|you can|you could|you should|you must|you may|you might|you need to|you have to|you ought to|you had better|you will|why not|maybe|consider|try to|best to|better to|(?:i|we) (?:recommend|suggest|advise)(?: that you)?|remember to|dont forget to|make sure you|be sure to)`;
// A first-person statement ("I take 20 mg of Prozac") is not advice: the verb must open the sentence or follow a lead-in.
const TREATMENT: readonly RegExp[] = [
  new RegExp(String.raw`(?:^|\b${LEAD}\s+)${VERB}(?:\s+\w+){0,2}?\s+${TARGET}\b(?!\s+(?:list|bottles?|names?|box|bag|schedule|with me|to the))`),
  /\b(?:i|we) prescrib\w+\b/,
];

/**
 * advice_dose, advice_diagnosis, advice_treatment for text a model wrote. Questions are skipped for diagnosis and
 * treatment (a clinician may ask "Do you have asthma?"). A dose is a (number, unit) pair that the ledger does not contain.
 */
export function adviceCodes(text: string, ledger: EvidenceLedger): GuardCode[] {
  const codes: GuardCode[] = [];
  const allowed = new Set<string>();
  for (const item of ledger.items) for (const k of doseKeys(item.text)) allowed.add(k);
  for (const k of doseKeys(text)) {
    if (!allowed.has(k)) {
      codes.push("advice_dose");
      break;
    }
  }
  for (const { t, question } of sentencesOf(text)) {
    if (question) continue;
    if (DIAGNOSIS.some((re) => re.test(t))) codes.push("advice_diagnosis");
    if (TREATMENT.some((re) => re.test(t))) codes.push("advice_treatment");
  }
  return unique(codes);
}

// ---------------------------------------------------------------- practice clinician findings (07 D15)

const FINDING: readonly RegExp[] = [
  /\b(?:looks?|sounds?|seems?) (?:normal|fine|good|healthy|great|clear|okay|ok)\b/,
  /\b(?:results?|tests?|scans?|labs?|bloodwork|xrays?) (?:is|are|show|shows|came back|came out|look|looks|was|were)\b/,
  /\byour (?:blood pressure|bp|weight|temperature|pulse|heart rate|oxygen|tests?|results?|scan|labs|bloodwork)\b/,
  /\bnothing (?:to worry|to be worried|wrong|unusual|serious)\b|\bno need to worry\b/,
  /\b(?:is|are|within) normal\b/,
];

/** clinician_finding: the pretend clinician states a result, or a number the user never gave. */
export function clinicianFindingCodes(text: string, ledger: EvidenceLedger): GuardCode[] {
  const known = new Set<string>();
  for (const item of ledger.items) for (const n of numberTokens(item.text)) known.add(n);
  const withoutScale = cleanText(text).replace(/\b1 to 10\b/g, " ");
  if (numberTokens(withoutScale).some((n) => !known.has(n))) return ["clinician_finding"];
  for (const { t, question } of sentencesOf(text)) {
    if (!question && FINDING.some((re) => re.test(t))) return ["clinician_finding"];
  }
  return [];
}

// ---------------------------------------------------------------- claims to be human (07 D15)

const CLAIMS_HUMAN: readonly RegExp[] = [
  /\b(?:i am|im) (?:really |actually )?(?:a |an )?(?:real|actual|human|licensed|qualified|certified) (?:doctor|nurse|clinician|physician|person|human|therapist|medical professional)\b/,
  /\b(?:i am|im) (?:really |actually )?(?:a )?(?:human|person)\b/,
  /\bthis is (?:a |an )?(?:real|actual) (?:visit|appointment|doctor|clinician|consultation|emergency)\b/,
  /\b(?:i am|im) not (?:an )?ai\b/,
];

/** claims_human: the model says it is a real person or that the visit is real. "Dr. Lee, your practice clinician" is allowed. */
export function claimsHumanCodes(text: string): GuardCode[] {
  const t = matchForm(cleanText(text)).text;
  return CLAIMS_HUMAN.some((re) => re.test(t)) ? ["claims_human"] : [];
}
