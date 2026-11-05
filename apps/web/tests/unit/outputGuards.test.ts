import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/ai/ledger";
import {
  adviceCodes,
  claimsHumanCodes,
  clinicianFindingCodes,
  collectStrings,
  mapStrings,
  stripUrls,
} from "@/lib/ai/guards/output";
import type { EvidenceLedger } from "@/features/shared/task";

const empty = (): EvidenceLedger => buildLedger({});
const ledgerOf = (rawText: string): EvidenceLedger => buildLedger({ rawText });

describe("stripUrls", () => {
  it("removes links, bare addresses and markdown images", () => {
    expect(stripUrls("See https://evil.test/?q=1 now")).toBe("See now");
    expect(stripUrls("![x](https://evil.test/a.png)")).toBe("");
    expect(stripUrls("Open [this page](https://evil.test) please")).toBe("Open please");
    expect(stripUrls("go to www.evil.test/path today")).toBe("go to today");
    expect(stripUrls("write to evil.com/steal now")).toBe("write to now");
    expect(stripUrls("see <https://evil.test> ok")).toBe("see ok");
  });

  it("removes javascript, data, vbscript and file schemes", () => {
    expect(stripUrls("click javascript:alert(1) now")).toBe("click now");
    expect(stripUrls("data:text/html;base64,PHNjcmlwdD4= end")).toBe("end");
    expect(stripUrls("vbscript:msgbox(1) and file:///etc/passwd")).toBe("and");
  });

  it("removes reference-style images, links and their definitions", () => {
    expect(stripUrls("![alt][ref] text\n\n[ref]: https://evil.test/p.png")).toBe("text");
    expect(stripUrls("see [the page][1]\n[1]: javascript:alert(1)")).toBe("see");
  });

  it("removes html tags that can load or run something", () => {
    expect(stripUrls('hello <img src="x" onerror="y"> there <script>bad()</script>')).toBe("hello there bad()");
  });

  it("works to a fixpoint: removing one piece cannot glue a new link together", () => {
    expect(stripUrls("ja[a](b)vascript:alert(1)")).toBe("");
    expect(stripUrls("ht![i](u)tps://evil.test/x")).toBe("");
    expect(stripUrls("ht[a](b)tp[a](b)s://evil.test")).toBe("");
    const nested = "[a](" + "ht".repeat(1) + "[b](c)tps://evil.test)";
    expect(stripUrls(nested)).not.toMatch(/https?:|\]\(/);
  });

  it("catches fullwidth and invisible-character spellings", () => {
    expect(stripUrls("see ｈｔｔｐｓ：//evil.test now")).toBe("see now");
    expect(stripUrls("see ht\u200Btps://evil.test now")).toBe("see now");
  });

  it("keeps [blank] placeholders and ordinary punctuation", () => {
    expect(stripUrls("It started [how many days] ago")).toBe("It started [how many days] ago");
    expect(stripUrls("I take pills (two a day), sometimes [how often]. Dr. Lee said so.")).toBe(
      "I take pills (two a day), sometimes [how often]. Dr. Lee said so.",
    );
  });

  it("is idempotent", () => {
    const once = stripUrls("a ![x](http://e.t/a.png) b www.e.t c javascript:x d");
    expect(stripUrls(once)).toBe(once);
  });
});

describe("mapStrings and collectStrings", () => {
  it("maps every string leaf of nested arrays and objects", () => {
    expect(mapStrings({ a: ["x https://e.t", { b: "y www.e.t" }], n: 3, f: true }, stripUrls)).toEqual({
      a: ["x", { b: "y" }],
      n: 3,
      f: true,
    });
  });

  it("leaves strings under skipped keys alone (ids and enum values are never URL-stripped)", () => {
    const input = { id: "https://x", items: [{ id: "q1", text: "see https://x now", section: "discussed" }] };
    const out = mapStrings(input, stripUrls, (key) => key === "id" || key === "section");
    expect(out).toEqual({ id: "https://x", items: [{ id: "q1", text: "see now", section: "discussed" }] });
    expect(input.items[0].text).toBe("see https://x now");
  });

  it("collects strings, honouring skipped keys", () => {
    const v = { id: "e1", list: ["a", { t: "b" }], n: 1 };
    expect(collectStrings(v)).toEqual(["e1", "a", "b"]);
    expect(collectStrings(v, (k) => k === "id")).toEqual(["a", "b"]);
  });
});

describe("adviceCodes: dose", () => {
  const trip = [
    "Take 500 mg now",
    "five hundred milligrams",
    "５００ mg",
    "5 units of insulin",
    "Use 2.5 mL twice",
    "two hundred and fifty mg",
    "500mg",
    "500 Milligrams",
    "1,000 mg is common",
    "a hundred micrograms",
    "take one tablet",
    "Try 10 mg",
    "5 mg of ibu\u200Bprofen",
  ];
  it.each(trip)("flags a dose that is not in the ledger: %j", (text) => {
    expect(adviceCodes(text, empty())).toContain("advice_dose");
  });

  it("allows a dose the user wrote, in any spelling of the same amount", () => {
    const ledger = ledgerOf("I take 20 mg of Prozac every morning.");
    expect(adviceCodes("I take 20 mg of Prozac every morning", ledger)).toEqual([]);
    expect(adviceCodes("I take twenty milligrams in the morning", ledger)).toEqual([]);
    expect(adviceCodes("I take ２０mg in the morning", ledger)).toEqual([]);
  });

  it("flags a different dose than the one the user wrote", () => {
    const ledger = ledgerOf("I take 20 mg of Prozac every morning.");
    expect(adviceCodes("I take 40 mg of Prozac every morning", ledger)).toContain("advice_dose");
    expect(adviceCodes("I take 20 tablets of Prozac", ledger)).toContain("advice_dose");
  });

  it("does not treat times, counts or the pain scale as doses", () => {
    const ledger = empty();
    for (const text of [
      "It helps to rest for 10 minutes.",
      "Rate the pain from 1 to 10.",
      "Come back in 2 weeks.",
      "It starts at 3pm every day.",
      "Tell me about the last 3 days.",
    ]) {
      expect(adviceCodes(text, ledger)).toEqual([]);
    }
  });
});

describe("adviceCodes: treatment", () => {
  const trip = [
    "Try ibuprofen for the pain",
    "take two tablets",
    "You should take your medicine",
    "Please start insulin",
    "You can try taking Tylenol",
    "Then increase the dose slowly",
    "You could stop your medication",
    "Use melatonin before bed",
    "I prescribe ibuprofen",
    "We recommend that you take aspirin",
    "Skip your pills tonight",
    "You must take the antibiotics",
  ];
  it.each(trip)("flags %j", (text) => {
    expect(adviceCodes(text, empty())).toContain("advice_treatment");
  });

  const quiet = [
    "You should take a rest",
    "Take your time",
    "Are you taking any medicine?",
    "I take 20 mg of Prozac every morning",
    "Tell me about the medicines you take.",
    "Bring a list of your medicines.",
    "Take the medicine list with you.",
    "Taking pills every day is hard for me.",
    "It is hard to take a break.",
    "You should drink some water and rest",
  ];
  it.each(quiet)("stays quiet on %j", (text) => {
    expect(adviceCodes(text, empty()).filter((c) => c === "advice_treatment")).toEqual([]);
  });

  it("I take 20 mg of Prozac every morning is allowed when the ledger has it, and a dose when it does not", () => {
    const text = "I take 20 mg of Prozac every morning";
    expect(adviceCodes(text, ledgerOf("I take 20 mg of Prozac every morning."))).toEqual([]);
    expect(adviceCodes(text, empty())).toEqual(["advice_dose"]);
  });
});

describe("adviceCodes: diagnosis", () => {
  const trip = [
    "You have cancer",
    "You have type 2 diabetes",
    "It is probably anxiety",
    "You may have asthma",
    "This sounds like a migraine",
    "You are suffering from depression",
    "You probably have a bad infection",
    "I diagnose you with something",
    "You were diagnosed with ADHD",
    "It's likely depression",
    "You might have heart disease",
    "you have ａｄｈｄ",
  ];
  it.each(trip)("flags %j", (text) => {
    expect(adviceCodes(text, empty())).toContain("advice_diagnosis");
  });

  const quiet = [
    "Do you have diabetes?",
    "Do you have any history of asthma?",
    "You may have to add a question",
    "You have been to the clinic before.",
    "It is flu season.",
    "You may have heard of ADHD.",
    "You have an appointment on Tuesday.",
    "Lying down in a dark room helps a little.",
    "I want to ask whether I have anxiety.",
  ];
  it.each(quiet)("stays quiet on %j", (text) => {
    expect(adviceCodes(text, empty())).toEqual([]);
  });
});

describe("adviceCodes: evasion", () => {
  it("sees through tags, invisible characters and lookalikes in the output", () => {
    expect(adviceCodes("You ha<system>ve cancer", empty())).toContain("advice_diagnosis");
    expect(adviceCodes("You h\u00ADave cаncer", empty())).toContain("advice_diagnosis"); // Cyrillic a
    expect(adviceCodes("Try ibu\u200Bprofen", empty())).toContain("advice_treatment");
  });

  it("returns each code once and only guard codes, never text", () => {
    const codes = adviceCodes("Take 5 mg. Take 6 mg. You have cancer. You have asthma.", empty());
    expect(codes).toEqual(["advice_dose", "advice_diagnosis"]);
    expect(codes.every((c) => /^advice_[a-z]+$/.test(c))).toBe(true);
  });
});

describe("clinicianFindingCodes", () => {
  const trip = [
    "Your blood pressure is fine",
    "That looks normal",
    "Your weight looks good",
    "The results are good",
    "The scan shows nothing unusual",
    "Nothing to worry about",
    "It was 120 over 80",
    "You are 40 years old",
    "Your temperature is up",
  ];
  it.each(trip)("flags %j", (text) => {
    expect(clinicianFindingCodes(text, empty())).toEqual(["clinician_finding"]);
  });

  it("allows digits the user already gave and the phrase 1 to 10", () => {
    const ledger = ledgerOf("It started 3 weeks ago and my pain is a 7.");
    expect(clinicianFindingCodes("You said 3 weeks. How bad is it from 1 to 10?", ledger)).toEqual([]);
    expect(clinicianFindingCodes("You said it is a 7.", ledger)).toEqual([]);
    expect(clinicianFindingCodes("You said it is a 8.", ledger)).toEqual(["clinician_finding"]);
    expect(clinicianFindingCodes("Rate it 1 to 10", empty())).toEqual([]);
  });

  it("compares whole numbers, so 3 does not match 13", () => {
    expect(clinicianFindingCodes("How about the last 3 days?", ledgerOf("It started 13 days ago."))).toEqual(["clinician_finding"]);
  });

  it("does not flag questions or ordinary clinician turns", () => {
    for (const text of [
      "Do you have your test results?",
      "How long has this been going on?",
      "Has anyone checked your blood pressure?",
      "Thank you. Take your time.",
      "Can you tell me more about the headaches?",
    ]) {
      expect(clinicianFindingCodes(text, empty())).toEqual([]);
    }
  });
});

describe("claimsHumanCodes", () => {
  it.each(["I am a real doctor", "I'm a real nurse", "This is a real appointment", "I am a licensed physician", "I'm not an AI", "I am a human"])(
    "flags %j",
    (text) => {
      expect(claimsHumanCodes(text)).toEqual(["claims_human"]);
    },
  );

  it.each([
    "I'm Dr. Lee, your practice clinician.",
    "This is not a real visit.",
    "I am an AI helper.",
    "This is a practice visit.",
    "In a real visit, the clinician would answer that.",
  ])("allows %j", (text) => {
    expect(claimsHumanCodes(text)).toEqual([]);
  });
});

describe("07 D14 escape hatches pass every output guard with an empty ledger", () => {
  const hatches = [
    "Do you have any questions for me?",
    "What detail do you want to add? You can start with: I am not sure ...",
    "I want to tell you about [what is happening].",
    "I am not sure how to say this. Can you ask me one question at a time?",
    "In a real visit, the clinician would answer that. For practice, let's keep going.",
    "Take your time. You can use Help me say it.",
    "We can stop here. You can end the practice.",
    "Reading from your notes is fine.",
    "I want to tell you: I keep getting headaches and my mom talks for me.",
  ];
  it.each(hatches)("%j", (text) => {
    expect(adviceCodes(text, empty())).toEqual([]);
    expect(clinicianFindingCodes(text, empty())).toEqual([]);
    expect(claimsHumanCodes(text)).toEqual([]);
  });
});
