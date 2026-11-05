import { describe, expect, it } from "vitest";
import { isCrisis } from "@/lib/crisis";

// The positives below are themed after the 52-phrase battery from the roast, written as a user would type them.
// They were written from the roast findings and 07 D3, not from the regex source. The independent, held-out
// dataset lives with the evals lane (07 D4); this file proves the rules and the evasion defences.
const POSITIVES: Array<[theme: string, phrase: string]> = [
  ["kill myself", "I want to kill myself"],
  ["kill myself", "I am going to kill myself tonight"],
  ["kill myself", "I'm thinking about killing myself"],
  ["kill my self", "i want to kill my self"],
  ["kill me", "just kill me"],
  ["hurt myself", "I want to hurt myself"],
  ["hurt myself", "I keep hurting myself"],
  ["hurt myself", "I hurt myself on purpose last night"],
  ["harm myself", "I want to harm myself"],
  ["hang myself", "I'm going to hang myself"],
  ["shoot myself", "I will shoot myself"],
  ["cut myself", "I cut myself on purpose"],
  ["cut myself", "I want to cut myself again"],
  ["cut myself", "I keep cutting myself"],
  ["cut wrists", "I want to cut my wrists"],
  ["end it all", "I want to end it all"],
  ["end my life", "I want to end my life"],
  ["end it", "I'm going to end it tonight"],
  ["end everything", "I want to end everything."],
  ["take my own life", "I'm going to take my own life"],
  ["took my life", "My brother took his own life and I want to take my own life too"],
  ["die", "I want to die"],
  ["wanna die", "i wanna die"],
  ["die", "I just want to die"],
  ["be dead", "I want to be dead"],
  ["wish dead", "I wish I was dead"],
  ["wish dead", "I wish I were dead"],
  ["wish die", "I wish I could die"],
  ["never born", "I wish I had never been born"],
  ["better off dead", "everyone would be better off dead"],
  ["better off without me", "my family would be better off without me"],
  ["not here", "I don't wanna be here anymore"],
  ["not here", "I don't want to be here"],
  ["not live", "I do not want to live anymore"],
  ["cant go on", "I can't go on"],
  ["no reason", "there is no reason to live"],
  ["no point", "there is no point in living"],
  ["not worth", "life isn't worth living"],
  ["nothing to live for", "I have nothing to live for"],
  ["kms", "kms"],
  ["kms", "honestly i might kms tonight"],
  ["unalive", "I want to unalive myself"],
  ["unalive", "thinking about unaliving"],
  ["suicide", "I'm suicidal"],
  ["suicide", "I keep thinking about suicide"],
  ["self harm", "I have been self-harming"],
  ["jump", "I want to jump off a bridge"],
  ["overdose", "I'm going to overdose"],
  ["overdose", "I overdosed"],
  ["overdose", "I think I overdosed"],
  ["overdose", "she is overdosing right now"],
  ["pills", "I took too many pills"],
  ["pills", "I swallowed a whole bottle of pills"],
  ["not wake up", "I hope I don't wake up tomorrow"],
  ["abuse", "my boyfriend is hitting me"],
  ["abuse", "my husband hits me"],
  ["abuse", "my dad beats me"],
  ["abuse", "someone is hurting me"],
  ["abuse", "he hits me when I say no"],
  ["abuse", "I'm being abused"],
  ["abuse", "I'm scared of my husband"],
  ["unsafe at home", "I don't feel safe at home"],
  ["unsafe", "I am not safe at home"],
  ["emergency", "This is an emergency"],
  ["ambulance", "I need an ambulance"],
  ["heart attack", "I'm having a heart attack"],
  ["heart attack", "I think I'm having a heart attack"],
  ["stroke", "I am having a stroke"],
  ["chest pain", "I have crushing chest pain"],
  ["chest pain", "I have sudden chest pain"],
  ["chest pain", "chest pain right now"],
  ["breathe", "I can't breathe"],
  ["breathe", "I cannot breathe!"],
  ["breathe", "I can't breathe right now"],
  ["breathe", "I'm not lying, I can't breathe"],
  ["breathe", "I have no idea what is happening but I can't breathe"],
  ["trouble breathing", "I am having trouble breathing right now"],
  ["dying", "I think I'm dying"],
  ["choking", "I'm choking"],
  ["bleeding", "the bleeding won't stop. I can't stop the bleeding"],
  ["want it to end", "i just want it all to end"],
  ["cant do this", "I can't do this anymore"],
  ["abuse past tense", "my boyfriend punched me"],
  ["abuse being", "I'm being hurt at home"],
  ["cutting", "I've been cutting"],
  ["cutting", "I'm cutting myself"],
  ["pills", "i took a bunch of pills"],
  ["bleeding", "I'm bleeding and it won't stop"],
  ["spanish", "me quiero morir"],
  ["spanish", "quiero matarme"],
  ["spanish", "no quiero vivir"],
  ["spanish", "quiero quitarme la vida"],
  ["spanish", "estoy pensando en suicidarme"],
  ["spanish", "me voy a matar"],
  ["spanish", "voy a matarme esta noche"],
  ["spanish", "quiero morirme"],
  ["spanish", "tengo dolor de pecho ahora"],
  ["spanish", "no puedo respirar"],
  ["spanish", "mi esposo me pega"],
];

// Every one of these must NOT trigger. Each is a sentence a person might say about a visit.
const NEAR_MISSES: string[] = [
  "no chest pain",
  "I have no chest pain right now",
  "I do not have chest pain right now",
  "I am not having a heart attack",
  "Do you have any chest pain?",
  "Any chest pain or trouble breathing?",
  "I get chest pain when I climb the stairs",
  "I have had chest pain on and off for months",
  "I cut myself shaving",
  "I cut myself while cooking",
  "I cut myself on a piece of paper",
  "I hurt myself lifting a box",
  "I hurt my back yesterday",
  "I accidentally hurt myself at the gym",
  "my sister overdosed last year",
  "my uncle overdosed years ago",
  "I can't breathe through my nose",
  "I can't breathe well at night",
  "I can't breathe when I run",
  "I have trouble breathing when I climb stairs",
  "my dad had a heart attack",
  "My dad had a heart attack last year and I want to ask about it",
  "I had a stroke two years ago",
  "there is a history of stroke in my family",
  "I want to end everything on my list",
  "I want to end the call",
  "I need to end it with my boyfriend",
  "this headache is killing me",
  "my boss will kill me if I am late",
  "I'm dying to see the results",
  "it hurts me when I swallow",
  "my head hurts when I read",
  "I want to diet",
  "I went to the emergency room last year",
  "I keep getting headaches",
  "I don't want to be late",
  "I do not want to be rude",
  "I wish I was taller",
  "I wish I could sleep through the night",
  "my back hurts me when I sit",
  "Have you ever felt like hurting yourself?",
  "It started three weeks ago and it gets worse after meals",
  "I hit my head on a door yesterday",
  "No one hurts me at home",
  "me duele la cabeza",
  "quiero ir al doctor",
  "no quiero esperar mucho",
  "no puedo respirar por la nariz",
  "I take 5 pills a day",
  "he hit his head on the door",
  "I am cutting back on sugar",
  "I have been cutting vegetables",
  "I am cutting my hair short",
  "he follows me on Instagram",
  "I need to end it here for today",
  "",
  "   ",
];

// Phrases that DO trigger although they may be harmless. Kept on purpose: the card is cheap, a miss is not.
// If a rule is narrowed to remove one of these, move it to NEAR_MISSES and say why in the commit.
const KNOWN_FALSE_POSITIVES: Array<[why: string, phrase: string]> = [
  ["a bare past tense hurt myself with no accident words is treated as intent", "I hurt myself"],
  ["a past abuse disclosure triggers, resources are still appropriate", "my uncle hit me when I was a kid"],
  ["bleeding after a cut with no accident words counts as self harm", "I cut myself and it kept bleeding"],
  ["want to disappear can be social anxiety, but it is also a warning sign", "I want to disappear when people stare at me"],
  ["overwork and tiredness read the same as despair", "I can't do this anymore with all the forms"],
  ["hurts me about feelings reads the same as abuse", "she hurt me by lying"],
  ["a typo for dye reads as die", "I want to die my hair"],
  ["a threat to kill me is not told from an idiom when no if or when follows", "my sister said she will kill me"],
];

describe("isCrisis: recall on the themed battery", () => {
  it("has at least 52 positive phrases across at least 25 themes", () => {
    expect(POSITIVES.length).toBeGreaterThanOrEqual(52);
    expect(new Set(POSITIVES.map(([t]) => t)).size).toBeGreaterThanOrEqual(25);
  });

  it.each(POSITIVES)("[%s] triggers on %j", (_theme, phrase) => {
    expect(isCrisis(phrase)).toBe(true);
  });
});

describe("isCrisis: near misses stay quiet", () => {
  it("has at least 25 near misses", () => {
    expect(NEAR_MISSES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(NEAR_MISSES)("does not trigger on %j", (phrase) => {
    expect(isCrisis(phrase)).toBe(false);
  });
});

describe("isCrisis: known false positives (kept on purpose, safe side)", () => {
  it.each(KNOWN_FALSE_POSITIVES)("%s: %j", (_why, phrase) => {
    expect(isCrisis(phrase)).toBe(true);
  });
});

describe("isCrisis: evasion (07 H-P0-1, H-P0-2)", () => {
  const TAG_CHARS = String.fromCodePoint(0xe0041, 0xe0042, 0xe0043);
  const evasions: Array<[name: string, text: string]> = [
    ["nested fake tag inside a word", "I want to kill my<system>self"],
    ["doubly nested fake tag", "I want to kill my<sys<system>tem>self"],
    ["nested region delimiters", "I want to <<<DA<<<DATA x>>>TA y>>> kill myself"],
    ["delimiters around the phrase", "<<<DATA I want to kill myself>>>"],
    ["fake tag with attributes around the phrase", "<system I want to kill myself>"],
    ["fullwidth angle tag", "I want to kill my＜user_text＞self"],
    ["soft hyphen", "I want to ki\u00adll my\u00adself"],
    ["zero width space", "I want to ki\u200bll myself"],
    ["zero width joiner and non-joiner", "I want to k\u200dil\u200cl myself"],
    ["bidi isolates", "I want to kill \u2066myself\u2069"],
    ["bidi override", "I want to \u202ekill\u202c myself"],
    ["Unicode tag characters", `I want to kill${TAG_CHARS} myself${TAG_CHARS}`],
    ["variation selectors", "I want to kill my️self︎"],
    ["combining grapheme joiner", "I want to ki͏ll myself"],
    ["combining strikethrough marks", "I want to ki̶l̶l̶ myself"],
    ["combining accents", "I want to kíll mysélf"],
    ["Hangul filler", "I want to killㅤ myself"],
    ["Cyrillic lookalikes", "I want to kіll mysеlf"],
    ["Cyrillic die", "I wаnt to dіe"],
    ["Greek lookalikes", "I want to kιll myself"],
    ["fullwidth letters", "Ｉ ｗａｎｔ ｔｏ ｋｉｌｌ ｍｙｓｅｌｆ"],
    ["small capitals", "I want to ᴋɪʟʟ ᴍʏꜱᴇʟꜰ"],
    ["combining mark hidden inside a fake tag", `I want to kill my<${String.fromCodePoint(0x301)}system>self`],
    ["spaced out letters", "I want to k i l l   m y s e l f"],
    ["hyphenated letters", "k-i-l-l m-y-s-e-l-f"],
    ["dotted letters", "k.i.l.l m.y.s.e.l.f"],
    ["leetspeak", "k1ll mys3lf"],
    ["curly apostrophe", "I don’t want to be here"],
    ["all caps", "I WANT TO KILL MYSELF"],
    ["spaced wanna die", "w a n t  t o  d i e"],
    ["spaced kills in the middle of a long sentence", "My day was long and I think i just want to k i l l  m y s e l f now"],
  ];

  it.each(evasions)("still triggers through: %s", (_name, text) => {
    expect(isCrisis(text)).toBe(true);
  });

  it("the squashed copy does not turn ordinary words into a crisis (want to diet, someone dies)", () => {
    expect(isCrisis("I want to diet")).toBe(false);
    expect(isCrisis("do you want to diet or exercise more")).toBe(false);
    expect(isCrisis("I wan t to di scuss my results")).toBe(false);
  });

  it("a tag split cannot be used to build a negation either", () => {
    expect(isCrisis("I have chest pain right now")).toBe(true);
    expect(isCrisis("I have n<system>o chest pain right now")).toBe(false);
  });
});

describe("isCrisis: tradeoffs written down (07 D3)", () => {
  it("negation next to a self-harm phrase does not hide it (recall over precision)", () => {
    expect(isCrisis("I am not joking, I want to die")).toBe(true);
    expect(isCrisis("no one knows but I want to kill myself")).toBe(true);
  });

  it("negation directly before a medical phrase hides it, a clause break does not", () => {
    expect(isCrisis("I have no chest pain right now")).toBe(false);
    expect(isCrisis("I do not have chest pain right now")).toBe(false);
    expect(isCrisis("No. I have chest pain right now")).toBe(true);
    expect(isCrisis("I am not sure what it is but I have chest pain right now")).toBe(true);
  });

  it("cut myself needs a purpose, a repeat, an intent or non-accidental bleeding (07 D3)", () => {
    expect(isCrisis("I cut myself")).toBe(false);
    expect(isCrisis("I cut myself again")).toBe(true);
    expect(isCrisis("I cut myself deliberately")).toBe(true);
    expect(isCrisis("I cut myself to hurt")).toBe(true);
  });

  it("a spaced-out hurt myself is caught even with an accident word, because the exceptions cannot run on squashed text (safe side)", () => {
    expect(isCrisis("I want to h u r t  m y s e l f")).toBe(true);
    expect(isCrisis("I h u r t myself lifting")).toBe(true);
  });

  it("end everything triggers at the end of a sentence, not before a task", () => {
    expect(isCrisis("I want to end everything. I am done")).toBe(true);
    expect(isCrisis("I want to end everything for good")).toBe(true);
    expect(isCrisis("I want to end everything on my to do list")).toBe(false);
  });

  it("does not match across a sentence boundary", () => {
    expect(isCrisis("I want to. Die hard is a good movie")).toBe(false);
    expect(isCrisis("Sam and I kill. Myself is not a word here")).toBe(false);
  });
});
