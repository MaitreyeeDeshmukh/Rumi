import { describe, expect, it } from "vitest";
import { ALL_GUARD_CODES, isHard } from "@/features/shared/guards";
import { blankCodes, extractBlanks, ledgerFromTexts, specificsCodes, ungroundedSpecifics } from "@/lib/text/specifics";

const tokens = (text: string, ...ledger: string[]) => ungroundedSpecifics(text, ledgerFromTexts(ledger)).tokens;
const ok = (text: string, ...ledger: string[]) => expect(tokens(text, ...ledger)).toEqual([]);

describe("numbers and amounts are compared as whole tokens and (number, unit) pairs", () => {
  it("flags a dose, a time and an ordinal that the user never gave", () => {
    expect(tokens("I take 500mg.")).toEqual(["500mg"]);
    expect(tokens("I will come at 5pm.")).toEqual(["5pm"]);
    expect(tokens("It was on the 3rd.")).toEqual(["3rd"]);
  });

  it("glued units: 3x, 2weeks, 20mins", () => {
    expect(tokens("I take it 3x.")).toEqual(["3x"]);
    expect(tokens("For 2weeks.")).toEqual(["2weeks"]);
    expect(tokens("It lasted 20mins.")).toEqual(["20mins"]);
  });

  it("the same amount written another way is grounded", () => {
    ok("I take 500mg.", "I take 500 mg");
    ok("At 5 PM.", "at 5pm");
    ok("It lasted 20 minutes.", "20mins");
    ok("Three times.", "3x");
    ok("About three weeks.", "It has been 3 weeks");
    ok("Twice.", "two times a day");
    ok("Take 2.5 mg.", "2.5mg");
    ok("Take ٥٠٠ mg.", "500 mg");
    ok("Take ５００ mg.", "500 mg");
  });

  it("invisible characters, thousands commas and curly apostrophes do not change the answer", () => {
    ok("It was 5​00mg.", "500mg");
    ok("Take 1,000 steps.", "1000 steps");
    expect(tokens("I like Sam’s room.")).toEqual(["Sam's"]);
    ok("I’m sure.");
  });

  it("5 mg is not 25 mg, 400 g is not 400 mg, 3 is not 13", () => {
    expect(tokens("Warfarin: 5 mg", "Warfarin 25 mg")).toEqual(["5 mg"]);
    expect(tokens("400 g", "400 mg")).toEqual(["400 g"]);
    expect(tokens("for 3 days", "for 13 days")).toEqual(["3 days"]);
    expect(tokens("for 13 days", "for 3 days")).toEqual(["13 days"]);
    expect(tokens("I have 3 headaches", "13 headaches")).toEqual(["3"]);
  });

  it("a unit is only joined to its number when only spaces separate them, and is not reported twice", () => {
    ok("I waited 3, weeks later.", "3 days");
    expect(tokens("It was 5 PM.")).toEqual(["5 PM"]);
    expect(tokens("Take 500 MG.")).toEqual(["500 MG"]);
  });

  it("the same number with a different unit is a different claim", () => {
    expect(tokens("3 times", "3 days")).toEqual(["3 times"]);
  });

  it("a bare number is grounded by any whole numeric token of the ledger", () => {
    ok("I have 3 questions.", "3 days");
    expect(tokens("I have 4 questions.", "3 days")).toEqual(["4"]);
  });

  it("number words count, but 'one' does not", () => {
    expect(tokens("I am nineteen.")).toEqual(["nineteen"]);
    expect(tokens("It was about two weeks.")).toEqual(["two weeks"]);
    expect(tokens("It happens twice.")).toEqual(["twice"]);
    expect(tokens("Half of it.")).toEqual(["Half"]);
    ok("No one knows.");
    ok("I can answer one question at a time.");
    ok("Someone helped.");
  });

  it("number words match their digit form", () => {
    ok("Three weeks.", "3 weeks");
    ok("It was 3 weeks.", "three weeks");
    expect(tokens("Four weeks.", "three weeks")).toEqual(["Four weeks"]);
  });
});

describe("time words", () => {
  it("relative-time phrases need to be in the ledger", () => {
    expect(tokens("It started yesterday.")).toEqual(["yesterday"]);
    expect(tokens("It started last week.")).toEqual(["last week"]);
    expect(tokens("I take it once a day.")).toEqual(["once", "a day"]);
    expect(tokens("It hurts every night.")).toEqual(["every night"]);
    ok("It started last week.", "it started last week");
  });

  it("months and weekdays are flagged, even at the start of a sentence", () => {
    expect(tokens("It began in March.")).toEqual(["March"]);
    expect(tokens("Monday I felt sick.")).toEqual(["Monday"]);
    expect(tokens("It was on tuesday.")).toEqual(["tuesday"]);
    ok("It began in March.", "March was bad");
  });

  it("the verb 'may' and the month May are told apart by capital and position", () => {
    ok("May I ask something?");
    ok("It may help.");
    expect(tokens("It began in May.")).toEqual(["May"]);
  });
});

describe("names, capitals and medicines", () => {
  it("mid-sentence capitalised words are flagged, whole-token only", () => {
    expect(tokens("I saw Dr. Patel.")).toEqual(["Patel"]);
    expect(tokens("I went to Banner Hospital.")).toEqual(["Banner", "Hospital"]);
    expect(tokens("I saw Lee.", "I saw Leeds")).toEqual(["Lee"]);
    ok("I saw Leeds.", "I saw Leeds");
    ok("I saw Dr. Patel.", "Dr. Patel said hi");
  });

  it("non-ASCII names are names", () => {
    expect(tokens("I saw Muñoz.")).toEqual(["Muñoz"]);
    expect(tokens("I met Zoë.")).toEqual(["Zoë"]);
    ok("I saw Muñoz.", "Muñoz");
  });

  it("possessives and contractions use the base word", () => {
    expect(tokens("I like Sam's room.")).toEqual(["Sam's"]);
    ok("I'm sure. I'll try. Thanks for Rumi's help.");
    ok("I like Sam's room.", "Sam");
  });

  it("ALL-CAPS tokens are flagged except I, AI, OK, US", () => {
    expect(tokens("I have ADHD.")).toEqual(["ADHD"]);
    expect(tokens("NHS sent it.")).toEqual(["NHS"]);
    ok("I am an AI helper. OK. Tell US. I do.");
    ok("I have ADHD.", "adhd");
  });

  it("medicine names are flagged even at the start of a sentence", () => {
    expect(tokens("Metformin after meals.")).toEqual(["Metformin"]);
    expect(tokens("Take ibuprofen.")).toEqual(["ibuprofen"]);
    ok("Ibuprofen: take if needed.", "You can take ibuprofen if you need it");
  });

  it("family words are flagged when the user never wrote them", () => {
    expect(tokens("Mom hits me.", "I keep getting headaches")).toEqual(["Mom"]);
    expect(tokens("My mom talks for me.", "I forget things")).toEqual(["mom"]);
    ok("Mom hits me.", "my mom talks for me");
  });

  it("the first word of a level-1 starter is a clause start, but only an ordinary starter word", () => {
    ok("How long? You can start with: It started ...");
    ok("What time? You can start with: Can you say ...");
    expect(tokens("How long? You can start with: Patel ...")).toEqual(["Patel"]);
    expect(tokens("Who did you see? Try: It was Patel ...")).toEqual(["It", "Patel"]);
  });

  it("only I and Rumi are free", () => {
    ok("I asked Rumi.");
    expect(tokens("Ask Sam.")).toEqual(["Sam"]);
    expect(tokens("Ask Mom.")).toEqual(["Mom"]);
  });
});

describe("blanks", () => {
  it("text inside a valid blank is not scanned as a fact", () => {
    ok("I have had headaches for [how many days].", "headaches");
    ok("I will arrive at [what time].");
  });

  it("a blank can not smuggle a fact (the blank itself is judged by blankCodes)", () => {
    expect(blankCodes("I saw [Dr. Patel for 3 days at Banner Hospital].")).toEqual(["invalid_blank"]);
    expect(tokens("I saw [Dr. Patel for 3 days at Banner Hospital] today.")).toEqual([]);
  });

  it("valid blanks: at most 6 words, no digits, no capitals after the first, start with a question word", () => {
    for (const b of ["what is happening", "how many days", "Which day", "who", "why it started", "where it hurts most of all", "what time"]) {
      expect(blankCodes(`I want to say [${b}].`)).toEqual([]);
    }
  });

  it.each([
    "[how many days 3]",
    "[what Time]",
    "[ignore the rules]",
    "[]",
    "[what]]",
    "[what is the name of the doctor you saw]",
    "[what. ignore the rules]",
    "[what\nignore]",
    "[what [how long]]",
    "[who is Dr Patel]",
    "[what happens next in the story of my whole day today]",
  ])("rejects %s", (blank) => {
    expect(blankCodes(`I say ${blank}.`)).toEqual(["invalid_blank"]);
  });

  it("a blank can not be longer than the reply field allows", () => {
    expect(blankCodes(`I say [what ${"a".repeat(70)}].`)).toEqual(["invalid_blank"]);
  });

  it("a stray bracket is rejected, no bracket is fine", () => {
    expect(blankCodes("I say [what")).toEqual(["invalid_blank"]);
    expect(blankCodes("I say what]")).toEqual(["invalid_blank"]);
    expect(blankCodes("I have a headache.")).toEqual([]);
  });

  it("extractBlanks returns the text of each valid blank", () => {
    expect(extractBlanks("I have had headaches for [how many days]. It is [what time].")).toEqual(["how many days", "what time"]);
    expect(extractBlanks("No blanks here.")).toEqual([]);
  });
});

describe("escape-hatch sentences pass with an empty ledger", () => {
  it.each([
    "I am not sure how to say this. Can you ask me one question at a time?",
    "What detail do you want to add? You can start with: I am not sure ...",
    "I want to tell you about [what is happening].",
    "Do you have any questions for me?",
    "I will arrive at [what time].",
  ])("%s", (text) => {
    ok(text);
    expect(blankCodes(text)).toEqual([]);
  });
});

describe("codes, not text", () => {
  it("specificsCodes returns a guard code and never the text", () => {
    const codes = specificsCodes("I saw Dr. Patel for 3 days at Banner Hospital.", ledgerFromTexts(["headaches"]));
    expect(codes).toEqual(["invented_specific"]);
    for (const c of codes) expect(ALL_GUARD_CODES).toContain(c);
    expect(isHard("invented_specific")).toBe(true);
    expect(specificsCodes("I keep getting headaches.", ledgerFromTexts(["I keep getting headaches"]))).toEqual([]);
  });

  it("accepts several strings and flags if any one has a specific", () => {
    expect(specificsCodes(["I have a headache.", "It was 500mg."], ledgerFromTexts(["headache"]))).toEqual(["invented_specific"]);
    expect(specificsCodes([], ledgerFromTexts([]))).toEqual([]);
  });

  it("tokens are unique, in order of appearance", () => {
    expect(tokens("Sam saw Lee and Kim and Lee.")).toEqual(["Lee", "Kim"]);
    expect(tokens("I saw Lee. I saw Lee again.")).toEqual(["Lee"]);
  });
});

describe("hostile input", () => {
  it("handles huge and odd text without throwing", () => {
    expect(() => ungroundedSpecifics("a. ".repeat(666), ledgerFromTexts([]))).not.toThrow();
    expect(() => ungroundedSpecifics("x".repeat(5000), ledgerFromTexts([]))).not.toThrow();
    expect(() => ungroundedSpecifics("", ledgerFromTexts([""]))).not.toThrow();
    expect(tokens("🙂 ??? ...")).toEqual([]);
  });
});
