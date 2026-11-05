import { describe, expect, it } from "vitest";
import { keepSupportedSymptoms, mainConcernCodes, planItemCodes } from "@/features/plan/keepSupportedSymptoms";

describe("keepSupportedSymptoms", () => {
  it("keeps only symptoms that share a content word with what the user wrote", () => {
    expect(keepSupportedSymptoms("I keep getting headaches", ["headaches", "chest pain"])).toEqual(["headaches"]);
    expect(keepSupportedSymptoms("my knee. also i dont like loud rooms", ["knee", "loud rooms", "dizziness"])).toEqual(["knee", "loud rooms"]);
  });

  it("a plural or singular form of the user's word counts", () => {
    expect(keepSupportedSymptoms("my head hurts, I get a headache", ["headaches"])).toEqual(["headaches"]);
  });

  it("stopwords alone never support a symptom, and an empty list stays empty", () => {
    expect(keepSupportedSymptoms("I want to ask about the thing", ["the that this"])).toEqual([]);
    expect(keepSupportedSymptoms("headaches", [])).toEqual([]);
    expect(keepSupportedSymptoms("", ["headaches"])).toEqual([]);
  });
});

describe("mainConcernCodes (D10)", () => {
  it("passes a concern made of the user's own words, in any case, with plural tolerance", () => {
    expect(mainConcernCodes("I keep getting headaches", "I keep getting headaches")).toEqual([]);
    expect(mainConcernCodes("I keep getting headaches", "HEADACHES")).toEqual([]);
    expect(mainConcernCodes("i get a headache", "headaches")).toEqual([]);
    expect(mainConcernCodes("dizzy", "dizzy")).toEqual([]);
  });

  it("flags a concern that is not from the user's words", () => {
    expect(mainConcernCodes("I keep getting headaches", "my stomach")).toEqual(["main_concern_not_from_user"]);
    expect(mainConcernCodes("I keep getting headaches", "")).toEqual(["main_concern_not_from_user"]);
    expect(mainConcernCodes("my knee hurts", "my knee and chest pain and dizziness")).toEqual(["main_concern_not_from_user"]);
  });

  it("is skipped when the user's text has no content word, so the fixed prompt can be used", () => {
    for (const raw of ["ok", "hi", "123", "🙂🙂", "   ", "?!", "a b"]) {
      expect(mainConcernCodes(raw, "anything at all")).toEqual([]);
    }
  });
});

describe("planItemCodes", () => {
  const user = (text: string) => ({ text, source: "user" as const });
  const suggested = (text: string) => ({ text, source: "suggested" as const });

  it("needs at least one item that comes from the user", () => {
    expect(planItemCodes([user("I want to tell you about my headaches.")])).toEqual([]);
    expect(planItemCodes([suggested("I want to ask what I should do next.")])).toEqual(["no_user_items"]);
    expect(planItemCodes([])).toEqual(["no_user_items"]);
  });

  it("the two generic suggestions are fine", () => {
    expect(planItemCodes([user("x"), suggested("I want to ask what I should do next."), suggested("I want to ask if I can have instructions in writing.")])).toEqual([]);
  });

  it.each([
    "I want to ask about a blood test.",
    "I want to ask about my pain.",
    "I want to ask about ibuprofen.",
    "I want to ask for a scan.",
    "I want to ask what dose to take.",
    "I want to ask about the 3 pills.",
    "I want to ask about Dr. Patel.",
    "I want to ask about my diagnosis.",
    "Come back in two weeks.",
    "I want to ask about Monday.",
  ])("a suggested item that is specific is rejected: %s", (text) => {
    expect(planItemCodes([user("x"), suggested(text)])).toEqual(["specific_suggestion"]);
  });

  it("the same words from the user are not judged here", () => {
    expect(planItemCodes([user("I want to ask about a blood test.")])).toEqual([]);
  });

  it("reports both codes when both apply", () => {
    expect(planItemCodes([suggested("I want to ask about my pain.")])).toEqual(["no_user_items", "specific_suggestion"]);
  });
});
