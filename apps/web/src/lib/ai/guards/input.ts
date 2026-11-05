/**
 * Input guards: two forms of every user string (07 D1), PII redaction and injection counting.
 *
 * - `promptForm` is what may be shown to a model. It is fenced and neutral.
 * - `matchForm` is what pattern checks (crisis, injection) run on. It is built FROM `promptForm`, so a
 *   crisis phrase can never reach the model in a shape the crisis check did not see.
 *
 * Region tokens are removed as delimiters only (`<<<`, `>>>`, known tags), keeping the text between them.
 * Removing whole `<<<...>>>` spans would let a user hide crisis words inside a fake token.
 */

// Invisible or format characters: Cf (zero width, bidi marks and isolates, soft hyphen, Unicode tag characters),
// default-ignorables (variation selectors, combining grapheme joiner, Hangul filler), private use, lone surrogates.
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Co}\p{Cs}]/gu;
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

/** Safe to place in a prompt (always inside a fence). Keeps single newlines because the ledger splits on them. */
export function promptForm(s: string): string {
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

export interface MatchForm {
  /**
   * Lowercase words separated by single spaces. Letters and digits only, apostrophes removed (`don't` is `dont`).
   * A lone "." stands for a sentence end (. ! ? ; or a newline).
   */
  text: string;
  /** Letters only, no spaces, digits read as leetspeak, "|" at sentence ends. Catches `k i l l  m y s e l f` and `k1ll mys3lf`. */
  squashed: string;
}

/** The form for crisis and injection patterns. Never shown to a model. */
export function matchForm(s: string): MatchForm {
  const lowered = promptForm(s).normalize("NFKD").toLowerCase().replace(MARKS, "").replace(INVISIBLE, "");
  const folded = Array.from(stripRegionTokens(lowered), foldChar)
    .join("")
    .replace(/['’‘`´ʼʻ′‛]/g, "");
  // A lone "." marks a sentence boundary, so patterns cannot join the end of one sentence to the start of the next.
  const text = folded
    .replace(/[.!?;\n]+/g, " . ")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  // "|" marks a sentence end here too, so a squashed pattern cannot join two sentences ("I want to. Die hard").
  const squashed = Array.from(folded.replace(/[.!?;]+(?=\s|$)|\n+/g, "|"), (ch) => LEET.get(ch) ?? ch)
    .join("")
    .replace(/[^\p{L}|]/gu, "");
  return { text, squashed };
}

// ---------------------------------------------------------------- PII

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE_NUMERIC = String.raw`(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2})`;
const DATE_TEXT = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?)?${MONTH}\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?\d{4}`;
const STREET_FULL = "street|avenue|ave|road|rd|lane|ln|boulevard|blvd|drive|court|place|terrace|circle|highway|hwy|parkway|pkwy|crescent|square|close|way";
const NOT_A_NAME =
  "the|a|an|down|up|on|to|at|of|in|from|this|that|my|your|every|per|mg|ml|mcg|mins|minutes|hours|days|weeks|months|years|blocks|miles|times|tablets|pills|units";
const CAP_STREET_FULL = STREET_FULL.split("|").map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join("|");

const PII: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  [/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, "[id number]"],
  [new RegExp(String.raw`\b(?:dob|d\.o\.b\.?|date of birth|birth ?date|born(?: on)?|birthday|b-day)\b[^\d\n]{0,12}(?:${DATE_NUMERIC}|${DATE_TEXT})`, "gi"), "[date of birth]"],
  [/\bborn in (?:19|20)\d{2}\b/gi, "[date of birth]"],
  [new RegExp(String.raw`(?<!\d)\d{1,2}[\/.-]\d{1,2}[\/.-](?:19\d{2}|200\d|201[0-2])(?!\d)`, "g"), "[date]"],
  [/(?<!\d)(?:19\d{2}|200\d)-\d{2}-\d{2}(?!\d)/g, "[date]"],
  [new RegExp(String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?)?${MONTH}\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?(?:19\d{2}|200\d|201[0-2])\b`, "gi"), "[date]"],
  [/\b(?:mrn|medical record(?: number| no\.?| #)?|chart (?:number|no\.?)|patient (?:id|number)|member id|policy (?:number|no\.?|#)|insurance (?:id|number)|npi)\b\s*[:#-]?\s*[A-Z0-9][A-Z0-9-]{2,}/gi, "[record number]"],
  [/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, "[number]"],
  [/\+\d[\d\s().-]{7,17}\d/g, "[phone]"],
  [/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, "[phone]"],
  [/(?<!\d)0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}(?!\d)/g, "[phone]"],
  [/(?<!\d)\d{9}(?!\d)/g, "[id number]"],
  [/\bp\.?o\.?\s*box\s+\d+\b/gi, "[address]"],
  [new RegExp(String.raw`\b\d{1,6}\s+(?:(?:[A-Z][A-Za-z'-]*|\d+(?:st|nd|rd|th))\s+){1,3}(?:${CAP_STREET_FULL})\b\.?(?:,?\s+(?:apt|apartment|unit|suite|ste|flat|#)\s*[\w-]+)?`, "g"), "[address]"],
  [new RegExp(String.raw`\b\d{1,6}\s+(?:(?:[A-Z][A-Za-z'-]*|\d+(?:st|nd|rd|th))\s+){1,3}(?:St|Dr|Ct|Pl|Cir|Ter|Ave|Rd|Ln)\b\.?(?=,|\s*$|\s+(?:apt|unit|#|\d))`, "g"), "[address]"],
  [new RegExp(String.raw`\b\d{1,6}\s+(?:(?!(?:${NOT_A_NAME})\b)[a-z0-9'-]+\s+){1,2}(?:street|avenue|ave|road|rd|boulevard|blvd|lane|ln)\b`, "g"), "[address]"],
  [/(?<![\d.,])\d{7,}(?!\d)/g, "[number]"],
];

/** Personal identifiers are replaced with a bracketed label before text reaches a model. Never logged. */
export function redactPii(s: string): { text: string; count: number } {
  let count = 0;
  let text = s;
  for (const [re, label] of PII) {
    text = text.replace(re, () => {
      count += 1;
      return label;
    });
  }
  return { text, count };
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

/** Counts how many injection patterns match. Counted and logged, never blocked: blunt text must not be punished. */
export function scanInjection(s: string): number {
  const { text, squashed } = matchForm(s);
  let hits = INJECTION.filter((p) => p.test(text)).length;
  if (hits === 0 && INJECTION_SQUASHED.test(squashed)) hits = 1;
  return hits;
}
