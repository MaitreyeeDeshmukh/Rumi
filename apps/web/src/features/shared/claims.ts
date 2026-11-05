/**
 * Claims about the user's body, health, history or safety. A model may write them in the user's own voice
 * ("I have diabetes.") only when the user's own words already say that kind of thing. Everything here is whole-word
 * matching on plain lists, so it is a floor, not a proof: a claim made only of ordinary words, a typo, another language
 * or a look-alike letter still gets through (known limit, listed in the handoff).
 *
 * Classes (each is checked by KEY, so "allergic" in the answer is covered by "allergy" in the user's words):
 *   condition   CONDITIONS + EXTRA_CONDITIONS, by phrase (single words by their first six letters; ALIAS joins diabetic and diabetes)
 *   symptom     body parts and complaints (chest, nausea, dizzy, rash ...), by word, not the bare words pain or hurts
 *   feeling     sad, angry, scared ..., by group (nervous, worried and anxious are one)
 *   medicine, drugs, pregnancy, allergy, smoking, alcohol, history (diagnosed, surgery, hospital ...), sleep, illness
 * Self-harm and abuse wording is different: it is hard whatever the user wrote, in any person ("yourself", "he hits her",
 * "being bullied"), because crisis text never reaches the model and an answer that says it was not asked for.
 *
 * A claim inside a [blank] is a claim too ("I have [what kind of cancer]" still tells the user they have a kind of cancer).
 * Only the topic the user or the clinician's own question named may appear there.
 */
import { CONDITIONS, EXTRA_CONDITIONS } from "@/features/shared/lists";
import type { GuardCode } from "@/features/shared/guards";
import { crisisTier } from "@/lib/crisis";
import { normalizeText, splitSentences } from "@/lib/text/tokens";

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "add" and "aids" are ordinary words. "anxious" is a feeling here (a nervous user and an anxious answer say the same thing).
const NOT_CONDITIONS = new Set(["add", "aids", "anxious"]);
const CONDITION_PHRASES = [...CONDITIONS, ...EXTRA_CONDITIONS].filter((c) => !NOT_CONDITIONS.has(c)).sort((a, b) => b.length - a.length);

const word = (alternatives: string): RegExp => new RegExp(String.raw`(?:^|[^a-z0-9])(${alternatives})(?![a-z0-9])`, "g");
const CONDITION_RE = word(CONDITION_PHRASES.map(escape).join("|"));

/** Words that name the same condition, symptom or feeling. Applied before a key is made. */
const ALIAS: Readonly<Record<string, string>> = {
  depressed: "depression", diabetic: "diabetes", asthmatic: "asthma", autistic: "autism", epileptic: "epilepsy", prediabetic: "prediabetes",
  stressed: "stress", anemic: "anemia", anaemia: "anemia", migraines: "migraine", tumour: "tumor", dyslexic: "dyslexia",
  "lactose intolerant": "lactose intolerance", seizure: "seizures",
  tummy: "stomach", belly: "stomach", abdomen: "stomach", abdominal: "stomach",
  swollen: "swelling", swelled: "swelling", swell: "swelling", swells: "swelling",
  exhausted: "tired", exhaustion: "tired", fatigue: "tired", tiredness: "tired", drained: "tired",
  nervous: "afraid", worried: "afraid", anxious: "afraid", scared: "afraid", frightened: "afraid", panicking: "afraid",
  anger: "angry", furious: "angry", miserable: "sad", upset: "sad",
  "throw up": "vomit", "throwing up": "vomit", "threw up": "vomit", "feel sick": "nausea", "feels sick": "nausea", "feeling sick": "nausea",
  teeth: "tooth", feet: "foot", nauseous: "nausea",
  "do not feel like eating": "appetite", "don't feel like eating": "appetite", "dont feel like eating": "appetite", "no appetite": "appetite", "lost my appetite": "appetite",
  "not eating": "appetite", "stopped eating": "appetite", "skip meals": "appetite", "skipping meals": "appetite", "skipped meals": "appetite",
};
/** The alias if there is one, else the word without a plural s (knees and knee are one key). */
const canon = (w: string): string => ALIAS[w] ?? (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

const CLASSES: readonly (readonly [string, RegExp])[] = [
  ["pregnancy", word(String.raw`pregnan\w*|expecting|miscarriage|having a baby|birth control|contracepti\w*|missed (?:a |my )?period`)],
  ["allergy", word(String.raw`allerg\w*|anaphyla\w*|hives|lactose intoleran\w*`)],
  ["smoking", word(String.raw`smok(?:e|es|ed|er|ers|ing)|vap(?:e|es|ed|ing)|tobacco|cigarettes?`)],
  ["alcohol", word(String.raw`alcohol\w*|drunk|beers?|wine|vodka|booze|hangovers?|(?:do not|don't|never|rarely|often|sometimes) drink|drinks? (?:a lot|too much|on|every \w+)|been drinking|drinking (?:a lot|too much|again)`)],
  ["drugs", word(String.raw`drugs|cocaine|heroin|meth|methamphetamine|opioids?|weed|marijuana|edibles?|stoned|high on`)],
  ["history", word(String.raw`diagnos\w*|surger\w*|operation|operated|hospitali[sz]ed|hospital|admitted|family history|medical history|chemo\w*|transplant\w*|broke (?:my|a)|broken|fractur\w*|crash|accident|stitches|x-?rays?|mri|scans?`)],
  ["medicine", word(String.raw`medicines?|medications?|meds|pills?|tablets?|prescriptions?|prescribed|antibiotics?|vitamins?|supplements?|painkillers?|inhalers?|antidepressants?|antipsychotics?|antihistamines?|steroids?|blood thinners?`)],
  ["illness", word(String.raw`illness\w*|diseases?|disorders?|sickness|conditions?|syndromes?|disabilit\w+`)],
  ["sleep", word(String.raw`sleep\w*|slept|nightmares?|wake(?:s)? up (?:a lot |often )?(?:in|during) the night|waking up|out of bed`)],
  [
    "feeling",
    word(
      String.raw`sad|angry|anger|scared|afraid|frightened|hopeless|lonely|upset|ashamed|nervous|worried|anxious|furious|miserable|panicking|empty inside|worthless|guilty|overwhelmed|cry|crying|cried|feel(?:s|ing)? down`,
    ),
  ],
  [
    "symptom",
    word(
      String.raw`head|headaches?|chest|stomach|tummy|belly|abdomen|abdominal|throat|cough\w*|fever\w*|rash\w*|nause\w*|dizz\w*|vomit\w*|throw(?:ing)? up|threw up|feel(?:s|ing)? sick|diarrh\w*|breath\w*|faint\w*|swell\w*|swollen|bleed\w*|numb\w*|tingl\w*|fatigue|drained|tired\w*|exhaust\w*|weight|appetite|seizures?|palpitations?|limp\w*|constipat\w*|itch\w*|heart|lungs?|knees?|ankles?|shoulders?|necks?|hips?|elbows?|wrists?|teeth|tooth|jaw|eyes?|ears?|skin|joints?|muscles?|legs?|arms?|hands?|feet|foot|fingers?|toes?|bones?|skip(?:ping|ped)? meals|not eating|stopped eating|(?:do not|don't|dont) feel like eating|no appetite|lost my appetite`,
    ),
  ],
];
const WORD_LEVEL: ReadonlySet<string> = new Set(["symptom", "feeling"]);

// ---------------------------------------------------------------- harm and abuse

const REFLEXIVE = String.raw`(?:my|your|him|her|them|our|one)\s?(?:self|selves)`;
const PERSON = String.raw`(?:dad|mom|mum|mother|father|parents?|stepdad|stepmom|brother|sister|teacher|friends?|partner|husband|wife|boyfriend|girlfriend|classmates?|kids|uncle|aunt|grandma|grandpa|boss|coach|neighbou?r|stranger|bullies)`;
const SUBJECT = String.raw`(?:he|she|they|(?:someone|somebody|anyone|anybody|everyone|everybody)(?: (?:at|from) (?:home|school|work))?|people|(?:[a-z']+ )?${PERSON})`;
const DONE_TO = String.raw`(?:hit|hits|hitting|hurt|hurts|hurting|beat|beats|beating|bully|bullies|bullied|bullying|threaten\w*|abus\w+|grab\w*|chok\w*|slap\w*|kick\w*|punch\w*|burn\w*|stab\w*|shoot\w*|shot)`;
const HARM = new RegExp(
  String.raw`(?:^|[^a-z0-9])(?:` +
    [
      String.raw`(?:hurt|harm|kill|cut|injure|punish|starve|hit|beat|burn|poison|strangle|drown|shoot|hang|stab|hate)\w*\s+${REFLEXIVE}`,
      String.raw`suicid\w*|self[- ]?harm\w*|overdos\w*|burdens?`,
      String.raw`end(?:ing|s|ed)?\s+(?:my|your|his|her|their)\s+(?:own\s+)?life|(?:take|taking|took)\s+(?:my|your|his|her)\s+own\s+life|end(?:ing)?\s+(?:it all|things|everything)`,
      String.raw`(?:want|wanted|wants|wish|wished|wanna|going|plan|planned|planning|thinking of|think about|thought about)\w*\s+(?:to\s+|about\s+|of\s+)?(?:die|dying|disappear|end it|be dead|not be here|not wake up|hurt\w*|kill\w*)`,
      String.raw`better off dead|no reason to live|not worth living`,
      String.raw`${SUBJECT}\s+(?:(?:always|often|sometimes|keeps?|kept|really|just|also|then|now|even|still)\s+)?${DONE_TO}`,
      String.raw`(?:am|is|are|was|were|being|been|get|gets|got|getting)\s+(?:bullied|beaten|abused|threatened|hit|slapped|kicked|punched|attacked|hurt by)`,
      String.raw`(?:someone|somebody)(?: (?:at|from) (?:home|school|work))? scar(?:es|ed|ing)? (?:me|us)`,
      String.raw`(?:un)?safe\s+(?:at|in|with)\s+\w+|not safe|feel\w*\s+(?:un)?safe|afraid (?:of|to go) (?:him|her|them|home)`,
      String.raw`abus\w+|violen\w*|assault\w*|molest\w*|rape\w*|bull(?:y|ies|ied|ying)`,
    ].join("|") +
    String.raw`)(?![a-z0-9])`,
);

// ---------------------------------------------------------------- reading a text

const BLANK = /\[[^\]]*\]/g;
const flat = (s: string): string => normalizeText(s).toLowerCase().replace(/[’‘]/g, "'");

function keysIn(t: string): Set<string> {
  const keys = new Set<string>();
  for (const m of t.matchAll(CONDITION_RE)) {
    const phrase = canon(m[1]);
    keys.add(`condition:${phrase.includes(" ") ? phrase : phrase.replace(/s$/, "").slice(0, 6)}`);
  }
  for (const [name, re] of CLASSES) {
    for (const m of t.matchAll(re)) {
      // A symptom or a feeling is its own word (chest is not headache); the other classes are one topic each.
      keys.add(WORD_LEVEL.has(name) ? `${name}:${canon(m[1].trim()).slice(0, 4)}` : name);
    }
  }
  return keys;
}

/** The keys of every claim term in a text, outside [blanks]. */
export function claimKeys(text: string): Set<string> {
  return keysIn(` ${flat(text).replace(BLANK, " ").replace(/\s+/g, " ")} `);
}

/** The keys of every claim term INSIDE the [blanks] of a text. A blank names a topic; it does not say the user has it. */
export function blankClaimKeys(text: string): Set<string> {
  const inside = [...flat(text).matchAll(BLANK)].map((m) => m[0].slice(1, -1));
  return keysIn(` ${inside.join(" . ")} `);
}

/** True when the text talks about hurting someone, being hurt, abuse or being unsafe, in any person. Questions included. */
export function harmWording(text: string): boolean {
  return HARM.test(` ${flat(text)} `);
}

const INTERROGATIVE = /^(?:what|how|when|where|which|who|whom|whose|why|can|could|do|does|did|would|will|is|are|was|were|have|has|had|shall|may|might|should|any|anything|anyone|anybody)\b/i;
const WH = /^(?:what|how|when|where|which|who|whom|whose|why)\b/i;
/** A real question: a question word or an auxiliary first, and a question mark last. */
export const isQuestion = (sentence: string): boolean => sentence.trim().endsWith("?") && INTERROGATIVE.test(sentence.trim());
/** A yes/no question asks WHETHER; a wh-question may take the claim for granted ("When did you start smoking?"). */
export const isYesNoQuestion = (sentence: string): boolean => isQuestion(sentence) && !WH.test(sentence.trim());

const POSSESSED = /\b(?:your|his|her|their)\s+(\w+(?:\s+\w+)?)/g;
const PRESUPPOSING = /\b(?:start|started|stop|stopped|quit|begin|began|been|since)\s+(\w+)/g;
/** A wh-question that takes a claim for granted: "your asthma", "start smoking", "been depressed". */
export function presupposesClaim(sentence: string): boolean {
  const t = flat(sentence);
  for (const m of t.matchAll(POSSESSED)) if (claimKeys(m[1]).size > 0) return true;
  for (const m of t.matchAll(PRESUPPOSING)) if (claimKeys(m[1]).size > 0) return true;
  return false;
}

/** Sentences that name a topic without saying anything about the person: "I am not sure about allergies.", "I want to ask about my sleep." */
const NO_ASSERTION = /\b(?:not sure|do not know|don't know|am unsure|unsure|want to (?:talk|ask|say something) about|would like to (?:talk|ask) about|have a question about)\b/i;

/**
 * Hard `invented_specific` when the text claims something the allowed sources do not say, or says anything about
 * self-harm or abuse. `allowed` are the user's own words (the ledger texts, plus for a hint the clinician's question).
 * `echo` are the clinician's question(s) a script is answering: the user may answer about that topic, but only in a question,
 * inside a [blank], or as "I [do or do not] <topic>", never as a plain statement.
 */
export function inventedClaimCodes(text: string, allowed: readonly string[], echo: readonly string[] = []): GuardCode[] {
  // The crisis check is the stricter, broader list: whatever it would stop in what a person typed must not appear in an answer either.
  if (harmWording(text) || crisisTier(text) === "certain") return ["invented_specific"];
  const have = claimKeys(allowed.join("\n"));
  const topic = claimKeys(echo.join("\n"));
  for (const sentence of splitSentences(text)) {
    const answering = isQuestion(sentence) || /^\s*i\s*\[/i.test(sentence) || NO_ASSERTION.test(sentence);
    for (const key of claimKeys(sentence)) if (!have.has(key) && !(topic.has(key) && answering)) return ["invented_specific"];
    for (const key of blankClaimKeys(sentence)) if (!have.has(key) && !topic.has(key)) return ["invented_specific"];
  }
  return [];
}
