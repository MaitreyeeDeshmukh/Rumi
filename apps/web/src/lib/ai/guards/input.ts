/**
 * Input guards: two forms of every user string (07 D1), PII redaction and injection counting.
 *
 * - `promptForm` is what may be shown to a model. It is fenced and neutral.
 * - `matchForm` is what pattern checks (crisis, injection) run on. It is built FROM `promptForm`, so a
 *   crisis phrase can never reach the model in a shape the crisis check did not see.
 *
 * Region tokens are removed as delimiters only (`<<<`, `>>>`, known tags), keeping the text between them.
 * Removing whole `<<<...>>>` spans would let a user hide crisis words inside a fake token.
 *
 * This file is imported by the browser (through crisis.ts). It must stay free of server modules and of regex
 * lookbehind (Safari before 16.4 fails to parse the whole bundle). tests/unit/clientSafe.test.ts enforces both.
 */
import { MONTHS, WEEKDAYS } from "@/features/shared/lists";

/**
 * The guards scan at most this many characters. Longer input gets an "input too large" result instead of a scan,
 * so no pattern can be made slow with a huge string. Request schemas cap every field far below this.
 */
export const MAX_GUARD_CHARS = 10_000;

// Invisible or format characters: Cf (zero width, bidi marks and isolates, soft hyphen, Unicode tag characters),
// default-ignorables (variation selectors, combining grapheme joiner, Hangul filler), private use, lone surrogates,
// the Braille blank (U+2800) and the Mongolian vowel separator (U+180E), which both render as nothing.
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Co}\p{Cs}\u2800\u180e]/gu;
const MARKS = /\p{M}/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

const TAG_NAMES = "user_text|user_memory|system|assistant|facts|style|task|data";
// A whole tag without attributes, else just the opening of a tag with attributes. The attributes and everything
// after them stay: deleting up to ">" would let a user hide crisis words inside "<system I want to die>".
const TAG = new RegExp(
  String.raw`<\s*\/?\s*(?:${TAG_NAMES})\s*\/?\s*>|<\s*\/?\s*(?:${TAG_NAMES})(?![\p{L}\p{N}])`,
  "giu",
);
const DELIMITER = /<<<|>>>/g;

/**
 * Removes region tags and the `<<<` / `>>>` delimiters until the string stops changing, so that removing one
 * piece can never glue together a new one (`<<<DA<<<DATA x>>>TA y>>>`, `<sys<system>tem>`).
 * Every pass either shortens the string or ends the loop.
 */
export function stripRegionTokens(s: string): string {
  let current = s;
  for (;;) {
    const next = current.replace(TAG, "").replace(DELIMITER, "");
    if (next === current) return current;
    current = next;
  }
}

function promptFormOnce(s: string): string {
  const cleaned = s
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(CONTROL, "")
    .replace(/\r\n?|[\u2028\u2029]/g, "\n");
  return stripRegionTokens(cleaned)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Safe to place in a prompt (always inside a fence). Keeps single newlines because the ledger splits on them.
 * Runs to a fixpoint, so a second pass can never change the result (removing a delimiter can leave a combining
 * mark next to a letter, and the next NFKC would compose them).
 */
export function promptForm(s: string): string {
  let current = promptFormOnce(s);
  for (;;) {
    const next = promptFormOnce(current);
    if (next === current) return current;
    current = next;
  }
}

// Lookalikes folded to the Latin letter a reader would see. Pairs are "from" then "to".
const CONFUSABLE_PAIRS = [
  // Cyrillic
  "аa", "вb", "еe", "ёe", "кk", "мm", "нh", "оo", "рp", "сc", "тt", "уy", "хx", "іi", "їi", "јj", "ѕs", "ԁd", "һh",
  "ѵv", "ӏl", "пn", "гr", "ԛq", "ԝw", "ɡg",
  // Greek
  "αa", "βb", "γy", "εe", "ηn", "ιi", "κk", "μu", "νv", "οo", "ρp", "ςc", "τt", "υu", "χx", "ωw",
  // Latin extras and small capitals
  "ıi", "ɑa", "ſs", "øo", "łl", "đd", "ħh", "ŧt", "ᴀa", "ʙb", "ᴄc", "ᴅd", "ᴇe", "ꜰf", "ɢg", "ʜh", "ɪi", "ᴊj", "ᴋk",
  "ʟl", "ᴍm", "ɴn", "ᴏo", "ᴘp", "ʀr", "ꜱs", "ᴛt", "ᴜu", "ᴠv", "ᴡw", "ʏy", "ᴢz",
];
const CONFUSABLE = new Map<string, string>(CONFUSABLE_PAIRS.map((p) => [p[0], p.slice(1)]));
const MULTI = new Map<string, string>([["ß", "ss"], ["æ", "ae"], ["œ", "oe"], ["þ", "th"]]);
const LEET = new Map<string, string>([["0", "o"], ["1", "i"], ["3", "e"], ["4", "a"], ["5", "s"], ["7", "t"]]);

const foldChar = (ch: string): string => CONFUSABLE.get(ch) ?? MULTI.get(ch) ?? ch;

/** Cyrillic, Greek and small-capital lookalikes become the Latin letter they imitate. Input should already be lowercase. */
export function foldConfusables(s: string): string {
  return Array.from(s, foldChar).join("");
}

export interface MatchForm {
  /**
   * Lowercase words separated by single spaces. Letters and digits only, apostrophes removed (`don't` is `dont`).
   * A lone "." stands for a sentence end (. ! ? ; ... or a newline). Commas are dropped.
   */
  text: string;
  /** Like `text` but a lone "," stands for each comma. The crisis rules read this form so "No, I can't breathe" is not a negation. */
  punct: string;
  /** Letters only, no spaces, digits read as leetspeak, "|" at sentence ends. Catches `k i l l  m y s e l f` and `iwanttodie`. */
  squashed: string;
  /** For each character of `squashed`, the index of the word it came from. Words are runs split at spaces and punctuation. */
  wordOf: number[];
  /** Number of letters of each word (indexed like `wordOf`). */
  wordLen: number[];
}

/** The form for crisis and injection patterns. Never shown to a model. */
export function matchForm(s: string): MatchForm {
  const lowered = promptForm(s).normalize("NFKD").toLowerCase().replace(MARKS, "").replace(INVISIBLE, "");
  const folded = foldConfusables(stripRegionTokens(lowered))
    .replace(/['’‘`´ʼʻ′‛]/g, "")
    // "kill my$elf", "wh@t": a symbol standing between two letters is read as the letter it imitates
    .replace(/(\p{L})([$@])(?=\p{L})/gu, (_m, a: string, sym: string) => a + (sym === "$" ? "s" : "a"));
  // A lone "." marks a sentence boundary, so patterns cannot join the end of one sentence to the start of the next.
  const punct = folded
    .replace(/[.!?;\n]+/g, " . ")
    .replace(/,+/g, " , ")
    .replace(/[^\p{L}\p{N}.,]+/gu, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  const text = punct.replace(/ , /g, " ").replace(/^, | ,$/g, "").replace(/ {2,}/g, " ").trim();

  // Squashed copy: "|" marks a sentence end (a dot followed by space or the end), other punctuation splits words.
  const wordOf: number[] = [];
  const wordLen: number[] = [];
  let squashed = "";
  // A dot after a single letter is not a sentence end ("m.y. .h.u.s.b.a.n.d"), only a dot after a word of two or more letters is.
  const words = folded
    .replace(/(\p{L}{2})[.!?;]+(?=\s|$)|\n+/gu, (_m, pre?: string) => `${pre ?? ""} | `)
    .split(/[^\p{L}\p{N}|]+/u);
  for (const w of words) {
    if (w === "") continue;
    const idx = wordLen.length;
    let letters = 0;
    for (const ch of w) {
      const c = LEET.get(ch) ?? ch;
      if (c === "|" || /\p{L}/u.test(c)) {
        squashed += c;
        wordOf.push(idx);
        if (c !== "|") letters += 1;
      }
    }
    wordLen.push(letters);
  }
  return { text, punct, squashed, wordOf, wordLen };
}

const squashedPrefix = (form: MatchForm, from: number, to: number): string => form.squashed.slice(from, to);

/**
 * A hit in `squashed` counts only when it is real evasion and not letters from neighbouring words:
 * it starts and ends on word edges, and it is either one run-together word ("iwanttodie") or contains at least
 * two single-letter words ("w a n t t o d i e"). That is why "upskill myself" and "reshoot myself" do not match.
 */
export function squashHitOk(form: MatchForm, start: number, end: number): boolean {
  const { wordOf, wordLen } = form;
  if (end <= start || end > wordOf.length) return false;
  if (end < wordOf.length && wordOf[end] === wordOf[end - 1]) return false;
  const oneWord = wordOf[start] === wordOf[end - 1];
  if (start > 0 && wordOf[start - 1] === wordOf[start]) {
    // inside a word only a pronoun may come first: "iwanttodie" and "iwant to die", not "upskillmyself"
    let first = start;
    while (first > 0 && wordOf[first - 1] === wordOf[start]) first -= 1;
    return ["i", "im", "ill", "id", "ive"].includes(squashedPrefix(form, first, start));
  }
  if (oneWord) return true;
  let singles = 0;
  for (let w = wordOf[start]; w <= wordOf[end - 1]; w++) if (wordLen[w] === 1) singles += 1;
  return singles >= 2;
}

// ---------------------------------------------------------------- PII

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_NUMERIC = String.raw`(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2})`;
const DATE_TEXT = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?)?${MONTH}\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?\d{4}`;
const STREET_FULL = "street|avenue|ave|road|rd|lane|ln|boulevard|blvd|drive|court|place|terrace|circle|highway|hwy|parkway|pkwy|crescent|square|close|way";
const NOT_A_NAME =
  "the|a|an|down|up|on|to|at|of|in|from|this|that|my|your|every|per|mg|ml|mcg|mins|minutes|hours|days|weeks|months|years|blocks|miles|times|tablets|pills|units";
const CAP_STREET_FULL = STREET_FULL.split("|").map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join("|");

interface PiiRule {
  re: RegExp;
  label: string;
  /** The match is ignored when the character just before it matches this (a lookbehind that older Safari cannot parse). */
  notAfter?: RegExp;
}

const PII: readonly PiiRule[] = [
  { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, label: "[email]" },
  // "sam at gmail dot com", "sam[at]gmail.com"
  { re: /\b[\w.+-]+\s*(?:\[at\]|\(at\)|\{at\}|\sat\s)\s*[\w-]+\s*(?:\[dot\]|\(dot\)|\.|\sdot\s)\s*(?:com|org|net|edu|gov|io|co|uk|us|ca|de)\b/gi, label: "[email]" },
  { re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, label: "[ip address]", notAfter: /[\d.]/ },
  { re: /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, label: "[ip address]" },
  { re: /\d{3}-\d{2}-\d{4}(?!\d)/g, label: "[id number]", notAfter: /\d/ },
  { re: /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g, label: "[id number]" },
  { re: new RegExp(String.raw`\b(?:dob|d\.o\.b\.?|date of birth|birth ?date|born(?: on)?|birthday|b-day)\b[^\d\n]{0,12}(?:${DATE_NUMERIC}|${DATE_TEXT})`, "gi"), label: "[date of birth]" },
  { re: /\bborn in (?:19|20)\d{2}\b/gi, label: "[date of birth]" },
  { re: /\d{1,2}[/.-]\d{1,2}[/.-](?:19\d{2}|200\d|201[0-2])(?!\d)/g, label: "[date]", notAfter: /\d/ },
  { re: /(?:19\d{2}|200\d)-\d{2}-\d{2}(?!\d)/g, label: "[date]", notAfter: /\d/ },
  { re: new RegExp(String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?)?${MONTH}\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?(?:19\d{2}|200\d|201[0-2])\b`, "gi"), label: "[date]" },
  {
    re: /\b(?:mrn|medical record(?: number| no\.?| #)?|chart (?:number|no\.?)|patient (?:id|number)|member (?:id|number)|policy (?:number|no\.?|#)|insurance (?:id|number|policy)|group (?:id|number)|account (?:id|number)|medicare (?:id|number)|npi)\b\s*(?:is|was|:|#|-)?\s*[A-Z0-9-]{0,10}\d[A-Z0-9-]*/gi,
    label: "[record number]",
  },
  { re: /\+\d[\d\s().-]{7,17}\d/g, label: "[phone]" },
  { re: /(?:\d[ -]?){12,18}\d(?!\d)/g, label: "[number]", notAfter: /\d/ },
  { re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, label: "[phone]", notAfter: /\d/ },
  { re: /0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\d)/g, label: "[phone]", notAfter: /\d/ },
  { re: /\d{3} \d{2} \d{4}(?!\d)/g, label: "[id number]", notAfter: /\d/ },
  { re: /\d{9}(?!\d)/g, label: "[id number]", notAfter: /\d/ },
  // digits typed one by one: "5 5 5 1 2 3 4 5 6 7"
  { re: /(?:\d[ .-]){9,}\d(?!\d)/g, label: "[number]", notAfter: /\d/ },
  { re: /\b(?:[Zz]ip(?: ?[Cc]ode)?|[Pp]ost ?[Cc]ode|[Pp]ostal [Cc]ode)\s*(?:is|:)?\s*(?:\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/g, label: "[postcode]" },
  { re: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, label: "[postcode]" },
  { re: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, label: "[postcode]" },
  { re: /\bp\.?o\.?\s*box\s+\d+\b/gi, label: "[address]" },
  { re: new RegExp(String.raw`\b\d{1,6}\s+(?:(?:[A-Z][A-Za-z'-]*|\d+(?:st|nd|rd|th))\s+){1,3}(?:${CAP_STREET_FULL})\b\.?(?:,?\s+(?:apt|apartment|unit|suite|ste|flat|#)\s*[\w-]+)?`, "g"), label: "[address]" },
  { re: new RegExp(String.raw`\b\d{1,6}\s+(?:(?:[A-Z][A-Za-z'-]*|\d+(?:st|nd|rd|th))\s+){1,3}(?:St|Dr|Ct|Pl|Cir|Ter|Ave|Rd|Ln)\b\.?(?=,|\s*$|\s+(?:apt|unit|#|\d))`, "g"), label: "[address]" },
  { re: new RegExp(String.raw`\b\d{1,6}\s+(?:(?!(?:${NOT_A_NAME})\b)[a-z0-9'-]+\s+){1,2}(?:street|avenue|ave|road|rd|boulevard|blvd|lane|ln)\b`, "g"), label: "[address]" },
  { re: /\d{7,}(?!\d)/g, label: "[number]", notAfter: /[\d.,]/ },
];

// Names are only recognised in explicit introductions. A name anywhere else in a sentence is NOT redacted:
// there is no reliable way to tell a name from any other capitalised word without a model.
const NAME = String.raw`((?:Dr\.?\s+)?[A-Z][a-z'’-]{1,20}(?:\s+[A-Z][a-z'’-]{1,20}){0,2})`;
const NAME_STOP = new Set<string>([
  "i", "the", "a", "an", "not", "so", "very", "just", "really", "sorry", "fine", "ok", "okay", "here", "there", "back", "going",
  "trying", "having", "feeling", "sure", "afraid", "scared", "worried", "anxious", "tired", "sad", "happy", "sick", "ill", "new",
  "in", "at", "on", "from", "for", "to", "with", "and", "but", "also", "still", "now", "today", "yesterday", "is", "was", "are",
  "my", "your", "it", "this", "that", "he", "she", "they", "we", "you", "no", "yes", "what", "when", "how", "why", "dr", "doctor",
  ...MONTHS, ...WEEKDAYS,
]);
const RELATION =
  "doctor|dr|gp|therapist|nurse|psychiatrist|specialist|counsellor|counselor|case ?worker|caregiver|carer|mom|mum|mother|dad|father|sister|brother|wife|husband|partner|son|daughter|friend|boyfriend|girlfriend|roommate|aunt|uncle|grandma|grandpa";
const NAME_RULES: readonly RegExp[] = [
  new RegExp(String.raw`(\b(?:[Mm]y (?:full )?name is|[Mm]y name['’]s|[Cc]all me|[Nn]ame:)\s+)${NAME}`, "g"),
  new RegExp(String.raw`(\b(?:I['’]m|I am|Im|[Tt]his is)\s+)${NAME}`, "g"),
  new RegExp(String.raw`(\b[Mm]y (?:${RELATION})\s+(?:is |named |called )?)${NAME}`, "g"),
];

/**
 * Personal identifiers are replaced with a bracketed label before text reaches a model. Never logged.
 * Over MAX_GUARD_CHARS nothing is scanned: the result has `tooLarge: true` and empty text, and the caller must refuse.
 */
export function redactPii(s: string): { text: string; count: number; tooLarge: boolean } {
  if (s.length > MAX_GUARD_CHARS) return { text: "", count: 0, tooLarge: true };
  let count = 0;
  let text = s;
  for (const { re, label, notAfter } of PII) {
    text = text.replace(re, (match: string, ...rest: unknown[]) => {
      if (notAfter) {
        const offset = rest.find((x): x is number => typeof x === "number") ?? 0;
        const before = text.charAt(offset - 1);
        if (offset > 0 && notAfter.test(before)) return match;
      }
      count += 1;
      return label;
    });
  }
  for (const re of NAME_RULES) {
    text = text.replace(re, (match: string, lead: string, name: string) => {
      const first = name.replace(/^Dr\.?\s+/, "").split(/\s+/)[0].toLowerCase();
      if (NAME_STOP.has(first)) return match;
      count += 1;
      return `${lead}[name]`;
    });
  }
  return { text, count, tooLarge: false };
}

// ---------------------------------------------------------------- injection

const INJECTION: readonly RegExp[] = [
  /\bignore (?:(?:all|any|your|the|my|these|every)\s+)*(?:(?:previous|prior|above|earlier|preceding|former)\s+)*(?:instructions?|rules|prompts?|directions?|guidelines|messages)\b/,
  /\b(?:disregard|override|bypass) (?:(?:all|any|your|the|every|previous|prior|above)\s+)*(?:instructions?|rules|guidelines|safety|restrictions|filters?|everything)\b/,
  /\bforget (?:everything|all)\b(?: (?:you|your|that|previous|prior|above|i|we))*/,
  /\b(?:reveal|repeat|print|show|display|output|leak|dump|recite|tell me|give me)\b.{0,30}\b(?:system prompt|your (?:instructions|prompt|rules)|api key|secret|password|hidden|initial instructions|canary)\b/,
  /\b(?:you are now|youre now|from now on you|act as|pretend (?:to be|you are|youre)|role ?play as|behave as|simulate being)\b/,
  /\b(?:developer|debug|admin|god|dan|jailbreak|sudo|unrestricted|unfiltered) mode\b|\bjailbreak\b|\bdo anything now\b/,
  /\b(?:system|assistant|developer) (?:message|prompt|instruction|override|role)\b|\bnew (?:instructions|rules|system prompt)\b/,
  /\b(?:api ?key|password|secret|token|credentials)\b/,
  /\b(?:do not|dont|never) (?:follow|obey|listen to|tell|mention) (?:the |your |any )?(?:rules|instructions|safety|policy|policies|guidelines)\b/,
  /\b(?:encode|decode|base64|rot13|translate)\b.{0,25}\b(?:instructions|prompt|above|everything)\b/,
  /\b(?:print|write|show|include|embed) (?:a |the )?(?:link|url|image|iframe|script)\b/,
];
const INJECTION_SQUASHED = /ignore(?:all|any|your|the)?(?:previous|prior|above)?(?:instructions|rules|prompt)/;

/**
 * Counts how many injection patterns match. Counted and logged, never blocked: blunt text must not be punished.
 * Only the first MAX_GUARD_CHARS characters are scanned; a longer input adds one extra hit so it shows in the logs.
 */
export function scanInjection(s: string): number {
  const tooLong = s.length > MAX_GUARD_CHARS;
  const { text, squashed } = matchForm(tooLong ? s.slice(0, MAX_GUARD_CHARS) : s);
  let hits = INJECTION.filter((p) => p.test(text)).length;
  if (hits === 0 && INJECTION_SQUASHED.test(squashed)) hits = 1;
  return hits + (tooLong ? 1 : 0);
}
