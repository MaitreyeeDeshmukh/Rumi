import { describe, expect, it } from "vitest";
import { buildLedger } from "@/lib/ai/ledger";

describe("buildLedger", () => {
  it("splits typed words into sentences and labels them U1, U2, ...", () => {
    const l = buildLedger({ rawText: "I keep getting headaches. My mom talks for me! Do you know why?" });
    expect(l.items.map((i) => [i.id, i.label, i.source])).toEqual([
      ["e1", "U1", "user_words"],
      ["e2", "U2", "user_words"],
      ["e3", "U3", "user_words"],
    ]);
    expect(l.items.map((i) => i.text)).toEqual(["I keep getting headaches.", "My mom talks for me!", "Do you know why?"]);
  });

  it("splits on newlines before collapsing spaces, so a pasted list keeps one entry per line", () => {
    const l = buildLedger({ rawText: "headaches\nnausea    in the morning\n\n  tired" });
    expect(l.items.map((i) => i.text)).toEqual(["headaches", "nausea in the morning", "tired"]);
  });

  it("keeps abbreviations inside one sentence", () => {
    const l = buildLedger({ rawText: "I saw Dr. Lee on Tuesday. It did not help." });
    expect(l.items.map((i) => i.text)).toEqual(["I saw Dr. Lee on Tuesday.", "It did not help."]);
  });

  it("thin means fewer than two user sentences, and plan or transcript items do not count", () => {
    expect(buildLedger({ rawText: "dizzy" }).thin).toBe(true);
    expect(buildLedger({ rawText: "dizzy. and tired" }).thin).toBe(false);
    expect(buildLedger({ rawText: "", planItems: [{ text: "a" }, { text: "b" }, { text: "c" }] }).thin).toBe(true);
    expect(buildLedger({ lines: [{ text: "a" }, { text: "b" }] }).thin).toBe(true);
  });

  it("labels plan items q1.. and transcript lines L1.. and tags their source", () => {
    const l = buildLedger({
      mainConcern: "I keep getting headaches",
      symptoms: ["headaches", "tired"],
      planItems: [{ text: "Why do I get headaches?" }, { text: "Can I have it in writing?" }],
      lines: [{ text: "How long has this been going on?" }, { text: "About three weeks." }],
    });
    expect(l.items.map((i) => i.label)).toEqual(["C1", "S1", "S2", "q1", "q2", "L1", "L2"]);
    expect(l.items.filter((i) => i.source === "plan")).toHaveLength(5);
    expect(l.items.filter((i) => i.source === "transcript")).toHaveLength(2);
    expect(new Set(l.items.map((i) => i.id)).size).toBe(l.items.length);
  });

  it("caps the user words at 40 pieces of 300 characters without cutting a sentence mid-word", () => {
    const many = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const manyL = buildLedger({ rawText: many });
    expect(manyL.items).toHaveLength(40);

    const ramble = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const rambleL = buildLedger({ rawText: ramble });
    expect(rambleL.items.length).toBeGreaterThan(1);
    expect(rambleL.items.every((i) => i.text.length <= 300)).toBe(true);
    expect(rambleL.items.map((i) => i.text).join(" ")).toBe(ramble);
    expect(rambleL.thin).toBe(true);
  });

  it("does not cut a legal 60 line transcript at 40 (the recap cites L41 to L60)", () => {
    const lines = Array.from({ length: 60 }, (_, i) => ({ text: `line ${i + 1}` }));
    const l = buildLedger({ lines });
    expect(l.items.at(-1)?.label).toBe("L60");
  });

  it("caps a transcript at the 60 lines the schema allows", () => {
    const l = buildLedger({ lines: Array.from({ length: 70 }, (_, i) => ({ text: `line ${i + 1}` })) });
    expect(l.items).toHaveLength(60);
  });

  it("normalises fullwidth digits so a dose the user wrote compares equal", () => {
    const l = buildLedger({ mainConcern: "I take ５００ mg" });
    expect(l.items[0].text).toBe("I take 500 mg");
  });

  it("an empty request gives an empty, thin ledger", () => {
    expect(buildLedger({})).toEqual({ items: [], thin: true });
  });
});
