import { describe, expect, it } from "vitest";
import { MAX_GUARD_CHARS } from "@/lib/ai/guards/input";
import { adviceCodes, claimsHumanCodes, clinicianFindingCodes, stripUrls } from "@/lib/ai/guards/output";
import { buildLedger } from "@/lib/ai/ledger";
import type { EvidenceLedger } from "@/features/shared/task";

const empty = (): EvidenceLedger => buildLedger({});
const ledgerOf = (rawText: string): EvidenceLedger => buildLedger({ rawText });

describe("07 H-4: treatment advice is found anywhere in the sentence", () => {
  it.each([
    "You should also take ibuprofen.",
    "You can also take Tylenol.",
    "You should probably take ibuprofen.",
    "You can safely take Tylenol.",
    "So take ibuprofen.",
    "Also, take Tylenol.",
    "And take ibuprofen with food.",
    "Just take Tylenol.",
    "I'd take Advil.",
    "Consider taking ibuprofen.",
    "Dr. Lee: Take Tylenol.",
    "A doctor may prescribe antibiotics.",
    "You need antibiotics.",
    "Antibiotics will help.",
    "Ibuprofen would help.",
    "I suggest you stop taking your pills.",
    "Okay, take two tablets of ibuprofen.",
    "Feel free to take Tylenol.",
    "Tome dos pastillas.",
    "Hay que prendre du paracétamol.",
  ])("flags %j", (s) => {
    expect(adviceCodes(s, empty())).toContain("advice_treatment");
  });

  it.each([
    "I take 20 mg of Prozac every morning.",
    "I took ibuprofen last night and it helped.",
    "I have been taking Tylenol for a week.",
    "I also take vitamins.",
    "Taking pills every day is hard for me.",
    "Ask whether I should take ibuprofen.",
    "Ask if I can stop taking my pills.",
    "I want to ask about taking ibuprofen.",
    "Bring a list of your medicines.",
    "Take the medicine list with you.",
    "Do you take any medicine?",
  ])("stays quiet on first-person narration and questions for the clinician: %j", (s) => {
    const ledger = ledgerOf("I take 20 mg of Prozac. I took ibuprofen last night. I take vitamins and Tylenol. I want to ask about my pills.");
    expect(adviceCodes(s, ledger).filter((c) => c === "advice_treatment")).toEqual([]);
  });
});

describe("07 H-5: only real questions are exempt", () => {
  it.each([
    "You have cancer, right?",
    "You probably have diabetes, don't you?",
    "It is probably anxiety, isn't it?",
    "Take ibuprofen, okay?",
    "Why not take ibuprofen?",
    "Have you tried ibuprofen?",
    "How about taking Tylenol?",
    "You have cancer. Right?",
    "Do you have cancer, right?",
  ])("flags %j", (s) => {
    expect(adviceCodes(s, empty()).length).toBeGreaterThan(0);
  });

  it.each(["Do you have any chest pain?", "Do you have asthma?", "Are you taking any medicine?", "Is it anxiety?", "Can I take ibuprofen?", "Dr. Lee: Do you have diabetes?"])(
    "lets the real question %j through",
    (s) => {
      expect(adviceCodes(s, empty())).toEqual([]);
    },
  );

  it("a tag question stating a finding is flagged as clinician_finding too", () => {
    expect(clinicianFindingCodes("Your test looks normal, right?", empty())).toEqual(["clinician_finding"]);
    expect(clinicianFindingCodes("Is your test normal?", empty())).toEqual([]);
  });
});

describe("07 H-7: doses in every spelling", () => {
  it.each([
    "Take 5 mls.",
    "Take 500mgs.",
    "Take 5 cc.",
    "Take 2 oz.",
    "Take 1/2 a tablet.",
    "Take 5OO mg.",
    "Take 500 мг.",
    "Take 5ОО mg.",
    "Take 3 times a day.",
    "Take it twice daily.",
    "Take one.",
    "Take a couple of tablets.",
    "Take half a tablet.",
    "Take a quarter of a tablet.",
    "Increase it to 40.",
    "You can double up.",
    "Take double the dose.",
    "Use it every 4 hours.",
  ])("flags %j as advice_dose", (s) => {
    expect(adviceCodes(s, empty())).toContain("advice_dose");
  });

  it("half a tablet and a fraction the user wrote are allowed back, a different one is not", () => {
    expect(adviceCodes("I take half a tablet", ledgerOf("I take half a tablet at night."))).toEqual([]);
    expect(adviceCodes("I take 1/2 a tablet", ledgerOf("I take 1/2 a tablet at night."))).toEqual([]);
    expect(adviceCodes("I take a quarter tablet", ledgerOf("I take half a tablet at night."))).toContain("advice_dose");
  });

  it("does not treat ordinary counting or times as doses", () => {
    for (const s of ["Take your time.", "Take a deep breath.", "Take one step at a time.", "It happens once you stand up.", "Come back in 2 weeks.", "I take it twice daily.", "Ask whether I should take it twice a day."]) {
      expect(adviceCodes(s, empty()).filter((c) => c === "advice_dose")).toEqual([]);
    }
  });
});

describe("07 H-8 and H-9: diagnoses and who said them", () => {
  it.each([
    "You are depressed.",
    "That is a panic attack.",
    "You have high blood pressure.",
    "It's probably just stress.",
    "This is a sign of heart disease.",
    "This could indicate cancer.",
    "Your symptoms suggest diabetes.",
    "That is caused by low iron.",
    "You may be anxious.",
    "You're having a panic attack.",
    "You have AIDS.",
    "Usted tiene diabetes.",
    "Vous avez un cancer.",
  ])("flags %j", (s) => {
    expect(adviceCodes(s, empty())).toContain("advice_diagnosis");
  });

  it("a condition the user wrote is not a new finding", () => {
    const ledger = ledgerOf("I have asthma and my doctor says I have high blood pressure.");
    expect(adviceCodes("Tell the doctor you have asthma.", ledger)).toEqual([]);
    expect(adviceCodes("You said you have asthma.", ledger)).toEqual([]);
    expect(adviceCodes("You have high blood pressure.", ledger)).toEqual([]);
    expect(adviceCodes("Tell the doctor you have asthma.", empty())).toContain("advice_diagnosis");
    expect(adviceCodes("You have cancer.", ledger)).toContain("advice_diagnosis");
  });

  it.each([
    "You have an asthma plan.",
    "You have anxiety about the visit.",
    "You have a lot of aids to help you.",
    "You have a flu shot card.",
    "You have time to add a question.",
    "You have a lot of stress about this.",
    "You have no cancer in your family, I hope.",
    "You have been feeling anxiety.",
  ])("a possession noun phrase is not a finding: %j", (s) => {
    expect(adviceCodes(s, empty()).filter((c) => c === "advice_diagnosis")).toEqual([]);
  });

  it("a question for the clinician with an indirect cue is not a finding", () => {
    expect(adviceCodes("Ask whether my headaches are a sign of cancer.", empty())).toEqual([]);
    expect(adviceCodes("I am worried this could indicate diabetes.", empty())).toEqual([]);
  });
});

describe("07 H-10: clinician_finding without false alarms", () => {
  const ledger = ledgerOf("My head hurts. It started three days ago.");
  it.each([
    "Has it lasted more than 5 days?",
    "On a scale of 0 to 10, how bad is it?",
    "Do you take it 2 times a day?",
    "Rate it 1-10.",
    "Let us practice for 5 minutes.",
    "Take 2 minutes.",
    "It is 10 am.",
    "Your answers look clear.",
    "That test is not part of this practice.",
    "Thank you, that was clear.",
  ])("does not trip on %j", (s) => {
    expect(clinicianFindingCodes(s, ledger)).toEqual([]);
  });

  it.each(["Your blood pressure is 120 over 80.", "Your test looks normal.", "Your heart sounds fine.", "The scan shows nothing unusual.", "That looks normal.", "Your temperature is up."])(
    "still flags the real finding %j",
    (s) => {
      expect(clinicianFindingCodes(s, ledger)).toEqual(["clinician_finding"]);
    },
  );
});

describe("07 P3: claims_human", () => {
  it.each(["I am a doctor.", "I'm a nurse.", "I'm not a bot.", "I'm a clinician.", "I am a physician.", "Soy doctora.", "No soy un robot.", "Je suis médecin.", "I am not an AI."])(
    "flags %j",
    (s) => {
      expect(claimsHumanCodes(s)).toEqual(["claims_human"]);
    },
  );
  it.each(["I'm Dr. Lee, your practice clinician.", "This is not a real visit.", "I am an AI helper.", "I am your practice clinician, Dr. Lee."])("allows %j", (s) => {
    expect(claimsHumanCodes(s)).toEqual([]);
  });
});

describe("07 H-13: stripUrls removes any domain, not a short list", () => {
  it.each([
    ["see goo.gl/abc now", "see now"],
    ["go to evil.ru please", "go to please"],
    ["visit bücher.de today", "visit today"],
    ["visit 例え.jp today", "visit today"],
    ["visit evil.рф today", "visit today"],
    ["open 1.2.3.4/x now", "open now"],
    ["open 192.168.0.1:8080/admin now", "open now"],
    ["see my-site.co.uk/page?x=1 now", "see now"],
    ["see Example.Com/Path now", "see Example.Com/Path now"],
  ])("%j", (input, expected) => {
    expect(stripUrls(input)).toBe(expected);
  });

  it("leaves abbreviations, decimals and ordinary punctuation alone", () => {
    for (const s of ["e.g. a headache", "i.e. the left side", "at 10 a.m. or 3 p.m.", "take 2.5 mg", "Dr. Lee said so.", "pain is 7.5 out of 10", "etc. and so on", "It hurts. Then it stops."]) {
      expect(stripUrls(s)).toBe(s);
    }
  });

  it("works to a fixpoint for domains too: removing a link can join the halves of a domain", () => {
    expect(stripUrls("ev[a](b)il.ru")).toBe("");
    expect(stripUrls("see ev![i](u)il.ru now")).toBe("see now");
    expect(stripUrls("ht[a](b)tp[a](b)s://evil.test/x")).toBe("");
  });

  it("drops text larger than MAX_GUARD_CHARS instead of scanning it, and the code guards call it invalid", () => {
    const big = "[".repeat(MAX_GUARD_CHARS + 1);
    const t0 = performance.now();
    expect(stripUrls(big)).toBe("");
    expect(adviceCodes(big, empty())).toEqual(["schema"]);
    expect(clinicianFindingCodes(big, empty())).toEqual(["schema"]);
    expect(claimsHumanCodes(big)).toEqual(["schema"]);
    expect(adviceCodes("1".repeat(64_000), empty())).toEqual(["schema"]);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("rules pinned by mutation checks", () => {
  it("a statement shaped like a question is not exempt unless it starts like one", () => {
    expect(adviceCodes("You have cancer?", empty())).toContain("advice_diagnosis");
    expect(adviceCodes("Take ibuprofen?", empty())).toContain("advice_treatment");
  });

  it("words that are also ordinary nouns are not conditions", () => {
    for (const s of ["You have aids available.", "You have add a question to ask."]) expect(adviceCodes(s, empty())).toEqual([]);
  });

  it("a doctor prescribing something is treatment advice even when the drug is not named", () => {
    expect(adviceCodes("Your doctor could prescribe something stronger.", empty())).toContain("advice_treatment");
  });
});
