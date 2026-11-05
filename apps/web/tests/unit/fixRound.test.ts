/**
 * Fix round after the Phase 1 roast. Finding ids (F-1 ...) match the roaster's report and the handoff.
 * The 46 original proofs live in roastRegressions.test.ts; the cases here widen them in both directions
 * (what must be refused, and what must still pass) and cover the P3 items.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { practiceFallback } from "@/features/practice/fallback";
import { planFallback } from "@/features/plan/fallback";
import { verifyEvidence } from "@/features/recap/verifyEvidence";
import { level1Codes } from "@/features/sayit/level1";
import { sayitFallback } from "@/features/sayit/fallback";
import { SPEAKERS } from "@/features/shared/constants";
import { PracticeRequest, SayItRequest } from "@/features/shared/schemas";
import type { RecapItem, Speaker, TranscriptLine } from "@/features/shared/types";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { blankCodes, dosesByDrug, ledgerFromTexts, ungroundedSpecifics, validateGrounding } from "@/lib/text/specifics";
import { ADVICE_REFUSAL, CLOSING_LINE, NOTES_LINE, STOP_LINE, WAIT_LINE } from "../../prompts/persona";
import { FOCUS_TEXT, MAX_CLINICIAN_TURNS, practiceTask } from "../../prompts/practice";
import { recapTask } from "../../prompts/recap";

const E = ledgerFromTexts([]);
const toks = (text: string, ...ledger: string[]) => ungroundedSpecifics(text, ledgerFromTexts(ledger)).tokens;
const lines1 = (text: string, speaker: Speaker = "A"): TranscriptLine[] => [{ id: "l1", speaker, text }];
const item = (section: RecapItem["section"], text: string, ...evidence: string[]): RecapItem => ({ section, text, evidence: evidence.length ? evidence : ["l1"] });
const accepted = (lines: TranscriptLine[], it: RecapItem, mySpeaker: Speaker = "B"): boolean =>
  verifyEvidence(lines, { items: [it], planStatus: [] }, mySpeaker).items.length > 0;
const turns = (text: string) => [
  { role: "clinician" as const, text: "Hi." },
  { role: "me" as const, text },
];
const pf = (t: ReturnType<typeof turns>, focus: "whole" | "problem" = "whole") =>
  practiceFallback(PracticeRequest.parse({ plan: DEMO_PLAN, turns: t, focus, companionName: "Rumi" }));

describe("F-1 stop requests, both directions", () => {
  it.each([
    "Stop",
    "Please stop.",
    "stop asking so many questions",
    "Can we stop?",
    "stop the practice",
    "I'm tired",
    "I am tired.",
    "I’m tired of this",
    "That's enough",
    "I need a break",
    "Let's take a break",
    "I have headaches. Please stop.",
  ])("ends the practice: %s", (t) => {
    const r = pf(turns(t));
    expect(r.clinicianSay).toBe(STOP_LINE);
    expect(r.isLastTurn).toBe(true);
  });

  it.each([
    "I want to stop taking my pills",
    "I'm so tired of these headaches",
    "I feel tired all the time",
    "I get tired in the afternoon",
    "I can't stop coughing",
    "I get off at the bus stop",
    "It is non-stop pain",
    "I'm tired after class",
    "I stopped eating dairy",
    "I keep stopping and starting my pills",
  ])("is content, not a request: %s", (t) => {
    const r = pf(turns(t));
    expect(r.clinicianSay).not.toBe(STOP_LINE);
    expect(r.isLastTurn).toBe(false);
  });

  it.each(["Should I stop taking ibuprofen?", "Can I stop my medicine?", "Do I stop the pills?"])("a question about their own care gets the advice refusal: %s", (t) => {
    expect(pf(turns(t)).clinicianSay.startsWith(ADVICE_REFUSAL)).toBe(true);
  });
});

describe("P3 practice fallback phrases", () => {
  it.each(["what is the usual dose of ibuprofen", "is my blood pressure ok", "give me a prescription", "What is the dosage?", "Is my heart rate normal?"])("advice: %s", (t) => {
    expect(pf(turns(t)).clinicianSay.startsWith(ADVICE_REFUSAL)).toBe(true);
  });

  it("'what should I do next' is a planned question, not a request for advice", () => {
    const r = pf(turns("What should I do next?"));
    expect(r.clinicianSay.startsWith(ADVICE_REFUSAL)).toBe(false);
    expect(pf(turns("What should I do?")).clinicianSay.startsWith(ADVICE_REFUSAL)).toBe(true);
  });

  it.each(["i dunno", "idk", "Dunno really", "no idea"])("not sure: %s", (t) => {
    expect(pf(turns(t)).clinicianSay).toBe(WAIT_LINE);
  });

  it("mentioning notes gets the persona line once, then the next question, and does not move the script on", () => {
    const first = pf(turns("I wrote some notes"));
    expect(first.clinicianSay).toBe(`${NOTES_LINE} When did it start?`);
    const again = pf([...turns("I wrote some notes"), { role: "clinician", text: first.clinicianSay }, { role: "me", text: "my notes again" }]);
    expect(again.clinicianSay.startsWith(NOTES_LINE)).toBe(false);
    const long = pf(turns("My notes say that I have had the headaches for a long time and they are bad every day"));
    expect(long.clinicianSay.startsWith(NOTES_LINE)).toBe(false);
  });

  it("the turn cap is one number in the prompt and in the code", () => {
    expect(MAX_CLINICIAN_TURNS).toBe(7);
    for (const f of ["problem", "questions", "needs", "next_steps", "whole"] as const) expect(practiceTask(f)).toContain(`after ${MAX_CLINICIAN_TURNS} clinician turns`);
    expect(practiceTask("whole")).not.toMatch(/after 8 clinician turns/);
    const stuck = Array.from({ length: MAX_CLINICIAN_TURNS }, () => [{ role: "clinician" as const, text: WAIT_LINE }, { role: "me" as const, text: "I am not sure" }]).flat();
    expect(pf(stuck).clinicianSay).toBe(CLOSING_LINE);
  });
});

describe("F-14 one closing rule", () => {
  it("every focus block says when to close, and none of them depends on a question the base rule also closes on", () => {
    for (const [focus, block] of Object.entries(FOCUS_TEXT)) {
      expect(block, focus).toMatch(/close/);
      expect(practiceTask(focus as never)).not.toMatch(/isLastTurn: true after you asked/);
    }
    expect(FOCUS_TEXT.questions).toMatch(/When the user has no more questions, close/);
    expect(FOCUS_TEXT.whole).toMatch(/After the user answers that, close/);
  });
});

describe("F-2 every sentence of a recap item must be backed", () => {
  const diary = lines1("Please keep a headache diary for two weeks. Write down when it starts and how strong it is.");

  it("a sentence the lines never said is demoted, wherever it is", () => {
    expect(accepted(diary, item("instructions", "Keep a headache diary. Avoid caffeine."))).toBe(false);
    expect(accepted(diary, item("instructions", "Avoid caffeine. Keep a headache diary."))).toBe(false);
    expect(accepted(lines1("Please take zorbexol daily."), item("instructions", "take panadol daily"))).toBe(false);
    expect(accepted(lines1("Please take ibuprofen daily."), item("instructions", "take zorbexol daily"))).toBe(false);
  });

  it("a diagnosis word the lines did not say is demoted even inside a matching sentence", () => {
    const l = lines1("Your head hurts after class. Does anything help?");
    expect(accepted(l, item("discussed", "Your head hurts after class because of migraine."))).toBe(false);
    expect(accepted(lines1("It may be a migraine. Rest."), item("discussed", "It may be a migraine."))).toBe(true);
  });

  it("a paraphrase that keeps the content is kept, including a short part of a long line", () => {
    expect(accepted(diary, item("instructions", "Keep a headache diary for two weeks."))).toBe(true);
    expect(accepted(diary, item("instructions", "Write down when it starts."))).toBe(true);
    expect(accepted(lines1("Please come back in four weeks. Bring the diary with you."), item("instructions", "Bring the diary to the next visit."))).toBe(true);
  });

  it("the coverage threshold is 75% of the content words of each sentence", () => {
    const l = lines1("Please keep a headache diary for two weeks.");
    expect(accepted(l, item("instructions", "Keep a headache diary carefully."))).toBe(true); // 3 of 4
    expect(accepted(l, item("instructions", "Keep a headache diary every morning."))).toBe(false); // 3 of 5
  });
});

describe("F-3 and F-6 meaning flips", () => {
  const flips: [string, string][] = [
    ["Don't stop the medicine.", "Stop the medicine."],
    ["Never skip the diary.", "Skip the diary."],
    ["Drink more water.", "Drink less water."],
    ["Take it before food.", "Take it after food."],
    ["Increase the walking each week.", "Decrease the walking each week."],
    ["Please quit smoking.", "Please keep smoking."],
    ["Give up caffeine for now.", "Use caffeine for now."],
    ["Stay away from ibuprofen for now.", "Ibuprofen: use for now."],
    ["You can drive today.", "You cannot drive today."],
  ];
  for (const [src, out] of flips) it(`${src} -> ${out}`, () => expect(accepted(lines1(src), item("instructions", out))).toBe(false));

  it("two negations keep a sentence positive, so equal parity is accepted", () => {
    expect(accepted(lines1("Do not skip the diary."), item("instructions", "Never skip the diary."))).toBe(true);
    expect(accepted(lines1("Do not skip the diary."), item("instructions", "Do not skip the diary."))).toBe(true);
    expect(accepted(lines1("Never lift heavy boxes."), item("instructions", "Never lift heavy boxes."))).toBe(true);
  });

  it("a negator in another sentence of the line does not matter", () => {
    expect(accepted(lines1("Never skip meals. Keep a headache diary."), item("instructions", "Keep a headache diary."))).toBe(true);
  });
});

describe("F-4 spelled-out units", () => {
  it("grams are not milligrams, milligrams are not micrograms", () => {
    expect(toks("Take 400 grams.", "Take 400 mg.")).toEqual(["400 grams"]);
    expect(toks("Take 100 milligrams.", "Take 100 mcg.")).toEqual(["100 milligrams"]);
    expect(toks("Take 200 micrograms.", "Take 200 mg.")).toEqual(["200 micrograms"]);
  });

  it("the same unit spelled out or abbreviated is the same amount", () => {
    expect(toks("Take 400 milligrams.", "Take 400 mg.")).toEqual([]);
    expect(toks("Take 400 mg.", "Take 400 milligrams.")).toEqual([]);
    expect(toks("Take 5 millilitres.", "Take 5 ml.")).toEqual([]);
    expect(toks("Take 2 litres.", "2 liters of water")).toEqual([]);
    expect(toks("Take 50 percent.", "Take 50%")).toEqual([]);
    expect(toks("Take 3 ounces.", "Take 3 oz")).toEqual([]);
    expect(toks("It was 101 degrees.", "It was 102 degrees")).toEqual(["101 degrees"]);
  });

  it("a recap item cannot swap the unit of a dose", () => {
    const ok = lines1("Take ibuprofen 400 mg daily.");
    expect(accepted(ok, item("medications", "Ibuprofen: 400 grams daily."))).toBe(false);
    expect(accepted(ok, item("medications", "Ibuprofen: 400 milligrams daily."))).toBe(true);
  });
});

describe("F-5 a dose belongs to the medicine it was said about", () => {
  it("dosesByDrug binds to the nearest medicine before, else after in the sentence, else the last one", () => {
    expect([...dosesByDrug("Take warfarin 5 mg and ibuprofen 200 mg.")].sort()).toEqual(["ibuprofen|a:200|mg", "warfarin|a:5|mg"]);
    expect([...dosesByDrug("Take 400 mg of ibuprofen.")]).toEqual(["ibuprofen|a:400|mg"]);
    expect([...dosesByDrug("Take ibuprofen. The dose is 400 mg.")]).toEqual(["ibuprofen|a:400|mg"]);
    expect([...dosesByDrug("Take warfarin 5 mg. Take 200 mg of ibuprofen.")].sort()).toEqual(["ibuprofen|a:200|mg", "warfarin|a:5|mg"]);
    expect([...dosesByDrug("Take 5 mg.")]).toEqual([]);
    expect([...dosesByDrug("Take cocodamol 5 mg.", ["cocodamol"])]).toEqual(["cocodamol|a:5|mg"]);
  });

  it("an item can not move a dose to another medicine, inside a line or across two lines", () => {
    const one = lines1("Take warfarin 5 mg and ibuprofen 200 mg.");
    expect(accepted(one, item("medications", "Ibuprofen: 5 mg."))).toBe(false);
    expect(accepted(one, item("medications", "Ibuprofen: 200 mg."))).toBe(true);
    expect(accepted(one, item("medications", "Warfarin: 5 mg."))).toBe(true);
    const two: TranscriptLine[] = [
      { id: "l1", speaker: "A", text: "Take warfarin 5 mg." },
      { id: "l2", speaker: "A", text: "Take ibuprofen 200 mg." },
    ];
    expect(accepted(two, item("medications", "Ibuprofen: 5 mg.", "l1", "l2"))).toBe(false);
    expect(accepted(two, item("medications", "Ibuprofen: 200 mg.", "l1", "l2"))).toBe(true);
  });
});

describe("F-7 numbers written as words", () => {
  it("hyphenated and spaced compounds are read whole", () => {
    expect(toks("Take twenty-one pills.", "Take 20 pills.")).toEqual(["21 pills"]);
    expect(toks("Take twenty one pills.", "Take 20 pills.")).toEqual(["21 pills"]);
    expect(toks("Take twenty-one pills.", "Take 21 pills.")).toEqual([]);
    expect(toks("Take 21 pills.", "Take twenty-one pills.")).toEqual([]);
    expect(toks("Take twenty pills.", "Take 20 pills.")).toEqual([]);
  });

  it("ordinals, in words or digits", () => {
    expect(toks("Come in the fourth week.", "Come in the second week.")).toEqual(["fourth"]);
    expect(toks("Come in the fourth week.", "the 4th week")).toEqual([]);
    expect(toks("It was the 4th week.", "the fourth week")).toEqual([]);
    expect(toks("Come in the second week.")).toEqual(["second"]);
    expect(toks("Give me a second.")).toEqual([]);
    expect(toks("This is the first thing I want to say.")).toEqual([]);
  });

  it("'one' with a unit is a duration, a bare 'one' is ordinary, and 'a week' equals 'one week'", () => {
    expect(toks("I had it for one week.")).toEqual(["one week"]);
    expect(toks("I had it for one week.", "I had it for a week.")).toEqual([]);
    expect(toks("I had it for a week.", "I had it for one week.")).toEqual([]);
    expect(toks("Take one pill.")).toEqual(["one pill"]);
    expect(toks("I can answer one question at a time. No one knows.")).toEqual([]);
  });

  it("vague amounts are still amounts", () => {
    expect(toks("It lasted a couple of days.")).toEqual(["a couple of days"]);
    expect(toks("It lasted a few days.")).toEqual(["a few days"]);
    expect(toks("It lasted several weeks.")).toEqual(["several weeks"]);
    expect(toks("It cost a million.")).toEqual(["a million"]);
    expect(toks("It lasted a few days.", "It lasted a few days.")).toEqual([]);
    expect(toks("I have a few questions.")).toEqual([]);
  });
});

describe("F-8 an instruction needs a line from someone else", () => {
  it("instructions, next steps and medicines can not cite only the user's own words", () => {
    const mine = lines1("I take ibuprofen sometimes. Come back in four weeks.", "B");
    for (const it of [item("instructions", "Take ibuprofen sometimes."), item("next_steps", "Come back in four weeks."), item("medications", "Ibuprofen: sometimes.")]) {
      expect(accepted(mine, it), it.section).toBe(false);
    }
    expect(accepted(mine, item("discussed", "I take ibuprofen sometimes."))).toBe(true);
  });

  it("one clinician line among the cited lines is enough, and the rule follows mySpeaker", () => {
    const both: TranscriptLine[] = [
      { id: "l1", speaker: "B", text: "Should I come back?" },
      { id: "l2", speaker: "A", text: "Please come back in four weeks." },
    ];
    expect(accepted(both, item("next_steps", "Come back in four weeks.", "l1", "l2"))).toBe(true);
    expect(accepted(lines1("Please come back in four weeks.", "D"), item("next_steps", "Come back in four weeks."), "D")).toBe(false);
    expect(accepted(lines1("Please come back in four weeks.", "A"), item("next_steps", "Come back in four weeks."), "D")).toBe(true);
  });
});

describe("F-9 and F-9b clause starts and the app's own lines", () => {
  it.each([
    "I want to ask: Why do I get these?",
    'She asked, "Why do I get these?"',
    "Hello, Doctor.",
    "Okay, Thank you.",
    "Note (What is it?)",
    "I want to tell you: My head hurts.",
  ])("a starter word after punctuation is not a name: %s", (t) => {
    expect(toks(t)).toEqual([]);
  });

  it("a name after punctuation is still a name", () => {
    expect(toks("I want to ask: Patel said so.")).toEqual(["Patel"]);
    expect(toks("Hello, Patel.")).toEqual(["Patel"]);
  });

  it("every fixed line the app can show passes grounding with an empty ledger", () => {
    for (const line of [WAIT_LINE, STOP_LINE, ADVICE_REFUSAL, CLOSING_LINE, NOTES_LINE, "Hi. I am Dr. Lee.", "Hi. Let's practice the next steps."]) {
      expect(toks(line), line).toEqual([]);
    }
  });
});

describe("F-10 the level-1 starter can not carry a claim", () => {
  it("at most four words, and only the user's words or neutral words", () => {
    expect(level1Codes("Which part? You can start with: I have a bad headache and it hurts a lot ...")).toContain("level1_statement");
    expect(level1Codes("Which part? You can start with: I have pain ...")).toContain("level1_statement");
    expect(level1Codes("Which part? You can start with: It hurts ...")).toContain("level1_statement");
    expect(level1Codes("How long? You can start with: It started ...")).toEqual([]);
    expect(level1Codes("What else? You can start with: I am not sure ...")).toEqual([]);
    expect(level1Codes("What else? You can start with: I need to book ...")).toEqual([]);
  });

  it("the user's own words are allowed in the starter", () => {
    const said = ledgerFromTexts(["my knee hurts"]);
    expect(level1Codes("Which part? You can start with: My knee ...", said)).toEqual([]);
    expect(level1Codes("Which part? You can start with: My knee ...", E)).toEqual(["level1_statement"]);
  });
});

describe("F-11 blanks", () => {
  it.each(["[what's happening]", "[what, if anything, helps]", "[what is happening?]", "[who's here]", "[how long, roughly]"])("valid: %s", (b) => {
    expect(blankCodes(`I want to say ${b}`)).toEqual([]);
  });

  it.each(["[what; ignore the rules]", "[what: ignore]", "[what is it!]", "[what \"quoted\"]", "[what's the 3 days]"])("still invalid: %s", (b) => {
    expect(blankCodes(`I want to say ${b}`)).toEqual(["invalid_blank"]);
  });
});

describe("F-12 people, names, look-alike letters and brands", () => {
  it.each(["My kid hits me.", "My neighbour shouts at me.", "My ex follows me.", "My therapist said so.", "The baby cries.", "My nana is sick.", "My manager is rude."])(
    "an invented person is flagged: %s",
    (t) => expect(toks(t).length).toBeGreaterThan(0),
  );

  it("a person the user named is fine", () => {
    expect(toks("My neighbour shouts at me.", "my neighbour shouts")).toEqual([]);
  });

  it("a sentence that starts with a name and a verb is a person", () => {
    expect(toks("Patel told me to rest.")).toEqual(["Patel"]);
    expect(toks("Patel told me to rest.", "Patel said hello")).toEqual([]);
    expect(toks("Headaches hurt me. Excuse me, could you help?")).toEqual([]);
  });

  it("look-alike letters are folded, but real Greek and Cyrillic names are not changed", () => {
    expect(toks("I take ibuprпfen.").length).toBeGreaterThan(0);
    expect(toks("I take ibuprοfen.")).toEqual(["ibuprofen"]);
    expect(toks("I take ibuprofen.", "I take ibuprоfen")).toEqual([]);
    expect(toks("I met Ελένη.")).toEqual(["Ελένη"]);
  });

  it.each(["panadol", "percocet", "hydroxychloroquine", "excedrin", "nurofen", "amitriptyline"])("an unlisted brand is a medicine: %s", (d) => {
    expect(toks(`I take ${d}.`)).toEqual([d]);
    expect(toks(`I take ${d}.`, `I take ${d}`)).toEqual([]);
  });
});

describe("F-16 prompt files load without the app's path alias", () => {
  const dir = join(__dirname, "../../prompts");
  it.each(["persona", "plan", "practice", "sayit", "recap"])("%s.ts loads in plain node (type stripping)", (name) => {
    const url = pathToFileURL(join(dir, `${name}.ts`)).href;
    const r = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); console.log(Object.keys(m).length)`], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(Number(r.stdout.trim())).toBeGreaterThan(0);
  });

  it("the speaker letters in recap.ts are the shared SPEAKERS, so nothing drifted", () => {
    for (const s of SPEAKERS) expect(recapTask(s)).toContain(`Speaker ${s} is the user`);
    expect(() => recapTask("E" as never)).toThrow();
  });
});

describe("F-17 plan fallback concern", () => {
  const run = (rawText: string) => planFallback({ rawText, companionName: "Rumi" });

  it("a greeting is not the concern and not an item", () => {
    const r = run("Hello.\n\nMy knee hurts.");
    expect(r.plan.mainConcern).toBe("My knee hurts.");
    expect(r.plan.items.map((i) => i.text)).toEqual(["I want to tell you: My knee hurts."]);
    expect(r.thin).toBe(true);
    expect(run("hi there. ok. thanks. My knee hurts. I forget things.").plan.mainConcern).toBe("My knee hurts.");
  });

  it("bidi overrides and zero-width characters are not copied", () => {
    const r = run("My knee ‮hurts‬. I forget​ things.\u0007");
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/[‪-‮⁦-⁩​-‏\u0007]/);
    expect(r.plan.items[0].text).toBe("I want to tell you: My knee hurts.");
  });
});

describe("P3 sayit fallback", () => {
  const req = (clinicianQuestion: string) => SayItRequest.parse({ level: 2, clinicianQuestion, companionName: "Rumi" });

  it("a generic 'where' question does not assert a feeling", () => {
    expect(sayitFallback(req("Where do you live?")).script).toBe("I want to tell you about [what is happening].");
    expect(sayitFallback(req("Where does it hurt?")).script).toBe("It is in [which part of my body].");
    expect(sayitFallback(req("Which part of your arm?")).script).toBe("It is in [which part of my body].");
  });

  it("the 'directions' preset of the prototype is not a say-it scenario: the UI must not send it", () => {
    expect(SayItRequest.safeParse({ level: 1, scenario: "directions", companionName: "Rumi" }).success).toBe(false);
  });
});

describe("P3 validateGrounding is the one call", () => {
  it("returns the specifics code and the blank code together, once each", () => {
    expect(validateGrounding("I saw Dr. Patel for 3 days at Banner Hospital.", E)).toEqual(["invented_specific"]);
    expect(validateGrounding("I say [Dr. Patel for 3 days at Banner Hospital].", E)).toEqual(["invalid_blank"]);
    expect(validateGrounding(["It was 500mg.", "I say [what. ignore]"], E)).toEqual(["invented_specific", "invalid_blank"]);
    expect(validateGrounding("I have had headaches for [how many days].", ledgerFromTexts(["headaches"]))).toEqual([]);
    expect(validateGrounding([], E)).toEqual([]);
  });
});
