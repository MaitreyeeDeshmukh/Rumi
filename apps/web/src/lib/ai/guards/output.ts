/**
 * Output guards. They return guard codes only, never text from the output (07 D15, D16).
 * Severity is decided in one place: features/shared/guards.ts.
 *
 * The matching is lexical. It cannot catch a harmful claim built only from ordinary words, and it will
 * sometimes block a harmless sentence; the retry and the deterministic fallback cover both cases.
 * Server only. Text longer than MAX_GUARD_CHARS is not scanned: the guards return the hard code "schema" for it.
 */
import { COMMON_DRUGS, CONDITIONS } from "@/features/shared/lists";
import type { GuardCode } from "@/features/shared/guards";
import type { EvidenceLedger } from "@/features/shared/task";
import { extractAmounts, normalizeText, numberTokens, splitSentences, wordSet } from "@/lib/text/tokens";
import { MAX_GUARD_CHARS, foldConfusables, matchForm, promptForm } from "./input";

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

// Any "label.label" with a lowercase top-level domain of 2 to 12 letters (including IDN such as .рф and .jp),
// a first label of two or more characters (so "e.g." and "a.m." are left alone) and an optional path.
const BARE_DOMAIN = /[\p{L}\p{N}-]{2,63}(?:\.[\p{L}\p{N}-]{1,63}){0,4}\.[\p{Ll}\p{Lo}]{2,12}(?![\p{L}\p{N}])(?:\/\S*)?/gu;
const URL_PIECES: readonly RegExp[] = [
  /!?\[[^\]]*\]\([^)]*\)/g, // inline link or image
  /!?\[[^\]]*\]\[[^\]]*\]/g, // reference-style link or image
  /^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, // reference definition
  /<\s*(?:https?|ftp|javascript|data|vbscript|file|mailto):[^>]*>/gi, // autolink
  /<\/?(?:a|img|script|iframe|style|link|svg|object|embed|form|input|meta|base)\b[^>]*>/gi,
  /\b(?:https?|ftps?|wss?):\/\/\S*/gi,
  /\b(?:javascript|data|vbscript|file|blob|mailto|tel|sms):\S+/gi,
  /\bwww\.\S+/gi,
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/\S*)?/g, // 1.2.3.4/path
  BARE_DOMAIN,
];

/**
 * Removes links, markdown images and dangerous schemes from free text, to a fixpoint (removing one piece can
 * join two halves into a new link). Run it only over free-text fields, never over ids or enum values.
 * React escapes text, so this is defense in depth against image-URL exfiltration, not the main control.
 * Text over MAX_GUARD_CHARS is dropped (empty string) rather than scanned.
 */
export function stripUrls(s: string): string {
  if (s.length > MAX_GUARD_CHARS) return "";
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

/** The text as the guards read it: NFKC, invisible characters and fake tags removed, digits folded, lookalike letters folded. */
const cleanText = (text: string): string => foldConfusables(normalizeText(promptForm(text)));

const tooLarge = (text: string): boolean => text.length > MAX_GUARD_CHARS;

const QUESTION_START = /^(?:do|does|did|have|has|had|is|are|was|were|am|any|how|what|when|where|why|which|who|whom|whose|can|could|would|should|will|shall|may|might|must)\b/;
// "Why not take ibuprofen?" and "Have you tried ibuprofen?" are suggestions in the shape of a question.
const SUGGESTION_QUESTION =
  /^(?:why not|why dont you|why dont we|how about|what about|have you tried|have you considered|did you try|shouldnt you|couldnt you|wouldnt you|cant you|isnt it better|would you like to try)\b/;
// "..., right?" "..., isnt it?" turn a statement into a question that still asserts.
const TAG_QUESTION = /,\s*(?:right|okay|ok|yes|no|correct|huh|eh|yeah|isn['’]?t it|aren['’]?t you|don['’]?t you|doesn['’]?t it|won['’]?t you|wouldn['’]?t you|can['’]?t you|couldn['’]?t you|shouldn['’]?t you|haven['’]?t you|didn['’]?t you|isn['’]?t that so|don['’]?t i|am i not|do you not)\s*[?!.\s]*$/i;
// "Dr. Lee: Take Tylenol." The speaker label is not part of the sentence.
const SPEAKER = /^\s*(?:(?:dr|mr|mrs|ms)\.?\s+)?[A-Za-z]+\s*:\s*/i;

interface Sentence {
  /** Lowercase words, apostrophes removed, see matchForm. */
  t: string;
  /** The sentence as written (speaker label removed). */
  raw: string;
  /** A real question: starts with an auxiliary or wh-word, ends with "?", is not a suggestion and has no tag. */
  question: boolean;
}

function sentencesOf(text: string): Sentence[] {
  return splitSentences(cleanText(text)).map((s) => {
    const raw = s.replace(SPEAKER, "");
    const t = matchForm(raw).text;
    const question = raw.trimEnd().endsWith("?") && QUESTION_START.test(t) && !SUGGESTION_QUESTION.test(t) && !TAG_QUESTION.test(raw);
    return { t, raw, question };
  });
}

const unique = (codes: GuardCode[]): GuardCode[] => [...new Set(codes)];

/** The clause before a match, without earlier sentences. */
const clauseBefore = (t: string, index: number): string => (t.slice(0, index).split(" . ").pop() ?? "").trim();

// "I take 20 mg" and "I have been taking Prozac" are the person talking about themselves, not advice.
const FIRST_PERSON_END = /(?:^|\s)(?:i|ive|im|we|weve)(?:\s+(?:have|am|was|had|also|usually|always|just|only|sometimes|often|regularly|still|now|then|been|really|currently|do|did|dont|didnt|never|already|will|can|cant))*\s*$/;
// "Ask whether I should take ibuprofen" is a question for the clinician, not advice.
const REPORTED = /\b(?:ask|asked|asking|asks|whether|wonder|wondering|question|questions|if|worried|worry|afraid|scared|fear|concerned|curious)\b/;

/** True when the words before a verb read as advice to the person and not as narration or a question for the clinician. */
const isAdvice = (before: string): boolean => !FIRST_PERSON_END.test(before) && !REPORTED.test(before);

// ---------------------------------------------------------------- doses (07 D15)

/** Spoken and written unit names mapped to one canonical unit, so "twenty milligrams" equals "20 mg". */
const DOSE_UNITS: Readonly<Record<string, string>> = {
  mg: "mg", mgs: "mg", milligram: "mg", milligrams: "mg", milligramme: "mg", milligrammes: "mg",
  mcg: "mcg", mcgs: "mcg", µg: "mcg", ug: "mcg", microgram: "mcg", micrograms: "mcg",
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", mls: "ml", cc: "ml", ccs: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  l: "l", litre: "l", litres: "l", liter: "l", liters: "l",
  oz: "oz", ounce: "oz", ounces: "oz",
  iu: "iu", unit: "unit", units: "unit",
  puff: "puff", puffs: "puff", drop: "drop", drops: "drop", pump: "pump", pumps: "pump", squirt: "squirt", squirts: "squirt",
  tablet: "tablet", tablets: "tablet", pill: "tablet", pills: "tablet",
  cap: "capsule", caps: "capsule", capsule: "capsule", capsules: "capsule",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  dose: "dose", doses: "dose", patch: "patch", patches: "patch", injection: "injection", injections: "injection",
  shot: "injection", shots: "injection", sachet: "sachet", sachets: "sachet", spoonful: "spoonful", spoonfuls: "spoonful",
};
const UNIT_ALT = alternation(Object.keys(DOSE_UNITS));

const SMALL: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUM_WORD_ALT = [...Object.keys(SMALL), "hundred", "thousand"].join("|");
const WORD_AMOUNT = new RegExp(
  String.raw`(?<![\p{L}\d])((?:a\s+(?=hundred|thousand))?(?:${NUM_WORD_ALT})(?:[\s-]+(?:and[\s-]+)?(?:${NUM_WORD_ALT}))*)[\s-]+(${UNIT_ALT})(?![\p{L}\d])`,
  "gu",
);
const PART_AMOUNT = new RegExp(String.raw`(?<![\p{L}\d])(half|quarter)\s+(?:of\s+)?(?:an?\s+)?(${UNIT_ALT})(?![\p{L}\d])`, "gu");
const DIGIT_LONG_UNIT = new RegExp(String.raw`(?<![\d.,/])(\d+(?:[.,]\d+)*)[\s-]*(${UNIT_ALT})(?![\p{L}\d])`, "gu");
const FRACTION_AMOUNT = new RegExp(String.raw`(?<![\d.,/])(\d+)\s*/\s*(\d+)\s*(?:of\s+)?(?:an?\s+)?(${UNIT_ALT})(?![\p{L}\d])`, "gu");

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

// Cyrillic unit abbreviations are not lookalikes of the Latin ones, so they are translated.
const CYRILLIC_UNITS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(\d)\s*мкг(?![\p{L}])/gu, "$1 mcg"],
  [/(\d)\s*мг(?![\p{L}])/gu, "$1 mg"],
  [/(\d)\s*мл(?![\p{L}])/gu, "$1 ml"],
  [/(\d)\s*г(?![\p{L}])/gu, "$1 g"],
];

/** "5OO mg" written with the letter O: inside a number-like run that contains a digit, O reads as zero. */
const fixLetterO = (t: string): string =>
  t.replace(/\b[0-9oO]{2,}(?=\s*[a-z%])/g, (run) => (/\d/.test(run) ? run.replace(/[oO]/g, "0") : run));

/** Every (number, unit) dose pair in the text, as "value|unit" keys. */
function doseKeys(text: string): Set<string> {
  let t = normalizeText(promptForm(text)).toLowerCase();
  for (const [re, to] of CYRILLIC_UNITS) t = t.replace(re, to);
  t = fixLetterO(foldConfusables(t));
  const keys = new Set<string>();
  const add = (value: string, unit: string): void => {
    const canon = DOSE_UNITS[unit];
    if (canon) keys.add(`${value}|${canon}`);
  };
  for (const a of extractAmounts(t)) add(a.value, a.unit);
  for (const m of t.matchAll(DIGIT_LONG_UNIT)) add(m[1].replace(/,(?=\d{3}(?:\D|$))/g, ""), m[2]);
  for (const m of t.matchAll(WORD_AMOUNT)) add(String(wordsToNumber(m[1])), m[2]);
  for (const m of t.matchAll(PART_AMOUNT)) add(m[1] === "half" ? "0.5" : "0.25", m[2]);
  for (const m of t.matchAll(FRACTION_AMOUNT)) add(`${m[1]}/${m[2]}`, m[3]);
  return keys;
}

const FREQ =
  String.raw`(?:(?:\d+|one|two|three|four|five|six)\s+times(?:\s+(?:a|per|each)\s+(?:day|week|hour))?|twice|thrice|once\s+(?:daily|a\s+day|per\s+day|a\s+week|every|each|before|after|at\s+night|in\s+the)|daily|nightly|weekly|every\s+(?:\d+\s+)?(?:hours?|days?|nights?|mornings?|weeks?)|(?:a|per)\s+day)`;
const QTY = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|a\s+couple|a\s+few|several|another|both|all|\d+)`;
// Quantities and frequencies given as an instruction are doses even when no unit follows: "Take 3 times a day", "Take one."
const DOSE_COMMANDS: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:take|use|apply|inject|swallow)(?:\s+\w+){0,2}?\s+${FREQ}\b`),
  new RegExp(
    String.raw`\b(?:take|use|apply|inject|swallow)\s+${QTY}(?:\s+of\s+(?:tablets?|pills?|capsules?|them|those|these|it|the)|\s+(?:more|daily|twice|each|every|with|before|after|at|then|and)\b|\s*(?:\.\s*)?$)`,
  ),
  /\b(?:increase|decrease|reduce|raise|lower|up|bump)\b(?:\s+\w+){0,3}?\s+(?:to|by)\s+\d/,
  /\bdouble up\b|\b(?:double|halve|half|reduce|cut)(?:\s+(?:the|your))?\s+dose\b|\btwice as much\b|\bhalf as much\b|\b(?:skip|miss)\s+a\s+dose\b|\btake double\b/,
];

// ---------------------------------------------------------------- diagnosis and treatment (07 D15)

// Conditions that 'lists.ts' lacks (the shared file is frozen); the exact additions are reported under ISSUES FOUND.
const EXTRA_CONDITIONS = [
  "high blood pressure", "low blood pressure", "high cholesterol", "low iron", "iron deficiency", "anemic", "depressed", "anxious",
  "bipolar disorder", "panic attack", "panic attacks", "stress", "stressed", "vitamin d deficiency", "underactive thyroid",
  "overactive thyroid", "irritable bowel", "food poisoning", "kidney infection", "chronic fatigue", "sleep disorder",
  "hormonal imbalance", "hormone imbalance", "heart condition", "blood clot", "dehydration", "malnutrition", "obesity", "diabetic",
  "autistic", "asthmatic", "epileptic", "prediabetic", "overweight",
];
// "add" and "aids" are ordinary words ("add a question", "aids to help you"); "AIDS" is checked on its own, in capitals.
const AMBIGUOUS_CONDITIONS = new Set(["add", "aids"]);
const COND = alternation([...CONDITIONS.filter((c) => !AMBIGUOUS_CONDITIONS.has(c)), ...EXTRA_CONDITIONS]);
const COND_ES = alternation(["cancer", "diabetes", "depresion", "ansiedad", "asma", "migrana", "infeccion", "hipertension", "artritis", "epilepsia", "anemia"]);
const COND_FR = alternation(["cancer", "diabete", "depression", "anxiete", "asthme", "migraine", "infection", "hypertension", "arthrite", "epilepsie", "anemie"]);
const DRUG = alternation(COMMON_DRUGS);

const NOT_A_GAP_WORD = String.raw`(?:to|been|heard|read|seen|noticed|mentioned|had|tried|asked|said|told|lot|lots|many|few|several|plenty|number|set|list|bunch|couple|any|more|no|not|never|enough|time|times|questions?)\b`;
// A condition followed by one of these is a possession noun phrase ("an asthma plan", "anxiety about the visit"), not a finding.
const NOT_FOLLOWED = String.raw`(?!\s+(?:plan|plans|card|cards|shot|shots|vaccine|vaccination|clinic|about|before|around|when|because|over|regarding|for|related|support|group|history|pamphlet|leaflet|medication|medicine|inhaler|app|appointment|appointments|test|check|checkup|questions?|season|symptoms?|information|info))`;

// Each pattern has exactly one capturing group: the condition. A condition the user wrote is not a new finding.
const DIAGNOSIS: ReadonlyArray<{ re: RegExp; indirect?: boolean }> = [
  {
    re: new RegExp(
      String.raw`\byou (?:(?:probably|likely|definitely|may|might|could|also|just|seem to|appear to|most likely) )*(?:have got|have|got|suffer from|are suffering from|are showing signs of|show signs of|are dealing with|are living with)(?:\s+(?!${NOT_A_GAP_WORD})\w+){0,3}?\s+(${COND})\b${NOT_FOLLOWED}`,
    ),
  },
  { re: new RegExp(String.raw`\byouve got(?:\s+(?!${NOT_A_GAP_WORD})\w+){0,2}?\s+(${COND})\b${NOT_FOLLOWED}`) },
  {
    re: new RegExp(
      String.raw`\b(?:it is|its|this is|that is|thats|it could be|it might be|it may be|it must be|this could be|this might be|that could be|that might be|that must be|this sounds like|that sounds like|it sounds like|sounds like|it seems like|it looks like|this looks like|looks like)(?:\s+(?:probably|likely|definitely|possibly|just|simply|really|clearly|most likely|a|an|some|your))*\s+(${COND})\b(?!\s+(?:season|shot|vaccine|vaccination|clinic))`,
    ),
  },
  {
    re: new RegExp(
      String.raw`\byou(?:re| are| seem to be| appear to be| may be| might be| could be| were)\s+(?:(?:probably|likely|clearly|definitely|just|a bit|very|quite|really|also|most likely)\s+)*(${COND})\b`,
    ),
  },
  { re: new RegExp(String.raw`\byou(?:re| are| were) (?:having|getting|experiencing|developing|showing) (?:an? )?(${COND})\b`) },
  {
    re: new RegExp(
      String.raw`\b(?:sign of|signs of|symptom of|symptoms of|indicates?|indicating|suggests?|suggesting|points to|caused by|due to|consistent with|result of|a case of)\s+(?:an?\s+|the\s+|some\s+)?(?:\w+\s+){0,1}?(${COND})\b`,
    ),
    indirect: true,
  },
  { re: new RegExp(String.raw`\b(?:usted tiene|tienes|tiene|padece|padeces|sufre de|sufres de|tiene usted)\s+(?:\w+\s+){0,2}?(${COND_ES})\b`) },
  { re: new RegExp(String.raw`\b(?:vous avez|tu as|vous souffrez de|tu souffres de)\s+(?:\w+\s+){0,2}?(${COND_FR})\b`) },
];
const DIAGNOSED =
  /\b(?:i|we) (?:diagnose|diagnosed|am diagnosing)\b|\byou (?:are|were|have been) diagnosed\b|\byouve been diagnosed\b|\b(?:the|your) diagnosis (?:is|was)\b/;

const TARGET = String.raw`(?:${DRUG}|tablets?|pills?|capsules?|medicines?|medications?|meds|insulin|painkillers?|antibiotics?|supplements?|vitamins?|dosages?|doses?|prescriptions?|antidepressants?|sedatives?|steroids?|inhalers?)`;
const VERB = String.raw`(?:take|taking|try|trying|tried|use|using|start|starting|stop|stopping|increase|increasing|decrease|decreasing|skip|skipping|swap|switch to|switching to|double|halve|drink|apply|inject|swallow|prescribe|prescribes|prescribed)`;
const TREATMENT_VERB = new RegExp(
  String.raw`\b${VERB}\b(?:\s+\w+){0,3}?\s+${TARGET}\b(?!\s+(?:list|bottles?|names?|box|bag|schedule|with me|to the))`,
  "g",
);
const TREATMENT_OTHER: readonly RegExp[] = [
  new RegExp(String.raw`\byou (?:need|require|will need|should have|ought to have|must have|should get|have to have)(?:\s+(?:some|a|an|the|more))?\s+${TARGET}\b`),
  new RegExp(String.raw`\b${TARGET}\s+(?:will|would|should|can|could|may|might)\s+(?:help|work|fix|cure|treat|ease|relieve)\b`),
  new RegExp(String.raw`\b(?:taking|using)\s+${TARGET}\s+(?:helps|works)\b`),
  /\b(?:i|we) prescrib\w+\b/,
  /\b(?:a|the|your|any)? ?(?:doctor|doctors|clinician|clinicians|gp)\s+(?:may |might |could |can |will |would |should )?prescribe\b/,
  new RegExp(
    String.raw`\b(?:tome|toma|tomar|tomen|use|usa|usar|empiece|comience|pruebe|prueba|deje de tomar|deje de usar)\b(?:\s+\w+){0,3}\s+(?:pastillas?|medicina|medicinas|medicamentos?|antibioticos?|ibuprofeno|paracetamol|aspirina|insulina|dosis|comprimidos?|tabletas?|capsulas?)\b`,
  ),
  new RegExp(
    String.raw`\b(?:prendre|prenez|prends|utiliser|utilisez|essayez|commencer|commencez|arreter|arretez)\b(?:\s+\w+){0,3}\s+(?:comprimes?|pilules?|medicaments?|antibiotiques?|paracetamol|ibuprofene|aspirine|insuline|doses?|gelules?)\b`,
  ),
];

function treatmentHit(t: string): boolean {
  TREATMENT_VERB.lastIndex = 0;
  for (let m = TREATMENT_VERB.exec(t); m !== null; m = TREATMENT_VERB.exec(t)) {
    const before = clauseBefore(t, m.index);
    // "Taking pills every day is hard" is a statement; "Consider taking ibuprofen" is advice
    if (before === "" && /^\w+ing\b/.test(m[0])) continue;
    if (isAdvice(before)) return true;
  }
  return TREATMENT_OTHER.some((re) => re.test(t));
}

function doseCommandHit(t: string): boolean {
  return DOSE_COMMANDS.some((re) => {
    const m = re.exec(t);
    return m !== null && isAdvice(clauseBefore(t, m.index));
  });
}

/**
 * advice_dose, advice_diagnosis, advice_treatment for text a model wrote. A real question ("Do you have asthma?") is
 * skipped for diagnosis and treatment; a question with a tag ("..., right?") is not. A dose is a (number, unit) pair
 * that the ledger does not contain; a condition the user already wrote is not a new finding.
 */
export function adviceCodes(text: string, ledger: EvidenceLedger): GuardCode[] {
  if (tooLarge(text)) return ["schema"];
  const codes: GuardCode[] = [];
  const allowedDoses = new Set<string>();
  const known = new Set<string>();
  for (const item of ledger.items) {
    for (const k of doseKeys(item.text)) allowedDoses.add(k);
    for (const w of wordSet(item.text)) known.add(w);
  }
  for (const k of doseKeys(text)) {
    if (!allowedDoses.has(k)) {
      codes.push("advice_dose");
      break;
    }
  }
  for (const { t, raw, question } of sentencesOf(text)) {
    if (doseCommandHit(t) && !question) codes.push("advice_dose");
    if (question) continue;
    const reported = REPORTED.test(t);
    let diagnosed = DIAGNOSED.test(t) || /\b[Yy]ou\b[^.?!]{0,30}\bAIDS\b/.test(raw);
    for (const { re, indirect } of DIAGNOSIS) {
      if (indirect && reported) continue;
      const m = re.exec(t);
      if (m !== null && !m[1].split(/\s+/).every((w) => known.has(w))) diagnosed = true;
    }
    if (diagnosed) codes.push("advice_diagnosis");
    if (treatmentHit(t)) codes.push("advice_treatment");
  }
  return unique(codes);
}

// ---------------------------------------------------------------- practice clinician findings (07 D15)

const BODY =
  "blood pressure|bp|weight|temperature|pulse|heart rate|heart|lungs?|oxygen|tests?|results?|scans?|labs?|bloodwork|xrays?|x rays?|throat|skin|ears?|eyes?|chest|breathing|symptoms?|reflexes|exam|checkup";
const RESULT_WORD =
  "normal|fine|good|great|healthy|clear|okay|ok|abnormal|high|low|elevated|positive|negative|bad|worrying|concerning|stable|improved|better|worse|up|down|nothing";
const FINDING: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:${BODY})\b(?:\s+\w+){0,3}?\s+(?:is|are|was|were|looks?|sounds?|seems?|shows?|came back|came out)\s+(?:\w+\s+){0,2}?(?:${RESULT_WORD})\b`),
  /\bnothing (?:to worry|to be worried|wrong|unusual|serious)\b|\bno need to worry\b/,
  /\b(?:that|this|it|everything|all)\s+(?:looks?|sounds?|seems?|is|are)\s+(?:completely |totally |perfectly |pretty )?normal\b/,
];
const TIME_AMOUNT = /\b\d+(?:[.,]\d+)?\s*(?:minutes?|mins?|seconds?|secs?|hours?|hrs?|am|pm)\b/g;
const SCALE = /\b[01]\s*(?:to|-|through)\s*(?:5|10)\b/g;

/** clinician_finding: the pretend clinician states a result, or a number the user never gave (times and the 0-to-10 scale are fine). */
export function clinicianFindingCodes(text: string, ledger: EvidenceLedger): GuardCode[] {
  if (tooLarge(text)) return ["schema"];
  const known = new Set<string>();
  for (const item of ledger.items) for (const n of numberTokens(item.text)) known.add(n);
  for (const { t, raw, question } of sentencesOf(text)) {
    if (question) continue;
    const counted = normalizeText(raw).toLowerCase().replace(TIME_AMOUNT, " ").replace(SCALE, " ");
    if (numberTokens(counted).some((n) => !known.has(n))) return ["clinician_finding"];
    if (FINDING.some((re) => re.test(t))) return ["clinician_finding"];
  }
  return [];
}

// ---------------------------------------------------------------- claims to be human (07 D15)

const ROLE = "doctor|nurse|physician|clinician|surgeon|therapist|psychiatrist|psychologist|medical professional|gp";
const CLAIMS_HUMAN: readonly RegExp[] = [
  new RegExp(String.raw`\b(?:i am|im) (?:really |actually )?(?:an? )?(?:(?:real|actual|human|licensed|qualified|certified|registered) )?(?:${ROLE})\b`),
  /\b(?:i am|im) (?:really |actually )?(?:a |an )?(?:real |actual )?(?:human|person|human being)\b/,
  /\bthis is (?:a |an )?(?:real|actual) (?:visit|appointment|doctor|clinician|consultation|emergency)\b/,
  /\b(?:i am|im) not (?:an? )?(?:ai|bot|robot|machine|computer|program|chatbot|artificial)\b/,
  /\bsoy (?:un |una )?(?:doctor|doctora|medico|medica|enfermero|enfermera|persona real|persona|humano|humana)\b|\bno soy (?:una? )?(?:ia|robot|bot|maquina|inteligencia artificial)\b/,
  /\bje suis (?:un |une )?(?:medecin|docteur|infirmier|infirmiere|vrai|vraie|humain|humaine)\b/,
];

/** claims_human: the model says it is a real person or a clinician. "I'm Dr. Lee, your practice clinician" is allowed. */
export function claimsHumanCodes(text: string): GuardCode[] {
  if (tooLarge(text)) return ["schema"];
  const t = matchForm(cleanText(text)).text;
  return CLAIMS_HUMAN.some((re) => re.test(t)) ? ["claims_human"] : [];
}
