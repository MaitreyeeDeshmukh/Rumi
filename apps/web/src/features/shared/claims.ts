/**
 * Claims about the user's body, health, history or safety. A model may write them in the user's own voice
 * ("I have diabetes.") only when the user's own words already say that kind of thing. Everything here is whole-word
 * matching on plain lists, so it is a floor, not a proof: a claim made only of ordinary words still gets through.
 *
 * Classes (each is checked by KEY, so "allergic" in the answer is covered by "allergy" in the user's words):
 *   condition   CONDITIONS + EXTRA_CONDITIONS, by phrase (single words by their first six letters: diabetes, diabetic)
 *   symptom     body parts and complaints (chest, nausea, dizzy, rash ...), not the bare words pain or hurts
 *   feeling     sad, angry, scared ...
 *   medicine    medicine, pills, antibiotics ...
 *   pregnancy, allergy, smoking, alcohol, history (diagnosed, surgery, hospital ...), sleep
 * Self-harm and abuse wording is different: it is hard whatever the user wrote, because crisis text never reaches the
 * model and an answer that says it was not asked for.
 */
import { CONDITIONS, EXTRA_CONDITIONS } from "@/features/shared/lists";
import type { GuardCode } from "@/features/shared/guards";
import { crisisTier } from "@/lib/crisis";
import { normalizeText } from "@/lib/text/tokens";

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "add" and "aids" are ordinary words; AIDS in capitals is not worth a special case here.
const CONDITION_PHRASES = [...CONDITIONS.filter((c) => c !== "add" && c !== "aids"), ...EXTRA_CONDITIONS].sort((a, b) => b.length - a.length);

const word = (alternatives: string): RegExp => new RegExp(String.raw`(?:^|[^a-z0-9])(${alternatives})(?![a-z0-9])`, "g");
const CONDITION_RE = word(CONDITION_PHRASES.map(escape).join("|"));

const CLASSES: readonly (readonly [string, RegExp])[] = [
  ["pregnancy", word(String.raw`pregnan\w*|expecting a baby|miscarriage`)],
  ["allergy", word(String.raw`allerg\w*|anaphyla\w*`)],
  ["smoking", word(String.raw`smok(?:e|es|ed|er|ers|ing)|vap(?:e|es|ed|ing)|tobacco|cigarettes?`)],
  ["alcohol", word(String.raw`alcohol\w*|drunk|(?:do not|don't|never|rarely|often|sometimes) drink|drinks? (?:a lot|too much|every \w+)`)],
  ["history", word(String.raw`diagnos\w*|surger\w*|operation|operated|hospitali[sz]ed|hospital|family history|medical history|chemo\w*|transplant\w*`)],
  ["medicine", word(String.raw`medicines?|medications?|meds|pills?|tablets?|prescriptions?|prescribed|antibiotics?|vitamins?|supplements?|painkillers?|inhalers?`)],
  ["illness", word(String.raw`illness\w*|diseases?|disorders?|sickness|conditions?|syndromes?`)],
  ["sleep",word(String.raw`sleep\w*|slept|nightmares?`)],
  ["feeling", word(String.raw`sad|angry|anger|scared|afraid|hopeless|lonely|upset|ashamed|nervous|worried|furious|miserable|panicking`)],
  [
    "symptom",
    word(
      String.raw`headaches?|chest|stomach|belly|throat|cough\w*|fever\w*|rash\w*|nause\w*|dizz\w*|vomit\w*|diarrh\w*|breath\w*|faint\w*|swell\w*|swollen|bleed\w*|numb\w*|tingl\w*|fatigue|tired\w*|exhaust\w*|weight|appetite|seizures?|palpitations?|limp\w*|constipat\w*|itch\w*`,
    ),
  ],
];

const WORD_LEVEL: ReadonlySet<string> = new Set(["symptom", "feeling"]);

/** Abuse and self-harm wording. Hard whatever the user wrote. */
const HARM = new RegExp(
  String.raw`(?:^|[^a-z0-9])(?:(?:hurt|harm|kill|cut|injure|punish|starve)(?:ing)? (?:my ?self|myself)|(?:want|going|wish|wanna|plan|planning|thinking of|think about)\w* (?:to )?(?:die|disappear|end it|end my life|be dead)|suicid\w*|self[- ]?harm\w*|overdos\w*|end my life|take my own life|(?:he|she|they|mom|mother|dad|father|husband|wife|partner|boyfriend|girlfriend|someone|somebody|my \w+) (?:hits?|beats?|hurts?|abuses?|threatens?|touches?|grabs?|chokes?) me|abus\w+|violen\w*|unsafe at home)(?![a-z0-9])`,
);

const BLANK = /\[[^\]]*\]/g;
const flat = (s: string): string => normalizeText(s).toLowerCase().replace(/[’‘]/g, "'");

/** The keys of every claim term in a text. Text inside [blanks] is not a claim (a blank asks for the fact, it does not state it). */
export function claimKeys(text: string): Set<string> {
  const t = ` ${flat(text).replace(BLANK, " ")} `;
  const keys = new Set<string>();
  for (const m of t.matchAll(CONDITION_RE)) {
    const phrase = m[1];
    keys.add(`condition:${phrase.includes(" ") ? phrase : phrase.replace(/s$/, "").slice(0, 6)}`);
  }
  for (const [name, re] of CLASSES) {
    for (const m of t.matchAll(re)) {
      // A symptom or a feeling is its own word (chest is not headache); the other classes are one topic each.
      keys.add(WORD_LEVEL.has(name) ? `${name}:${m[1].slice(0, 4)}` : name);
    }
  }
  return keys;
}

/** True when the text says it wants to hurt someone or reports abuse. Checked whatever the user wrote. */
export function harmWording(text: string): boolean {
  const t = ` ${flat(text).replace(BLANK, " ")} `;
  return HARM.test(t) || crisisTier(text) === "certain";
}

/**
 * Hard `invented_specific` when the text claims something the allowed sources do not say, or says anything about
 * self-harm or abuse. `allowed` are the user's own words (the ledger texts, plus for a hint the clinician's question).
 */
export function inventedClaimCodes(text: string, allowed: readonly string[]): GuardCode[] {
  if (harmWording(text)) return ["invented_specific"];
  const have = claimKeys(allowed.join("\n"));
  for (const key of claimKeys(text)) if (!have.has(key)) return ["invented_specific"];
  return [];
}
