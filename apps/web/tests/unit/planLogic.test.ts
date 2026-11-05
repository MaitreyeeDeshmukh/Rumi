import { describe, expect, it } from "vitest";
import { keepSupportedSymptoms, mainConcernCodes } from "@/features/plan/keepSupportedSymptoms";

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
