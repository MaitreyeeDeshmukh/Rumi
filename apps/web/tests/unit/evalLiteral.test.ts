import { describe, expect, it } from "vitest";
import { literalClean } from "../evals/scorers/literal";

describe("literalClean", () => {
  it("short plain sentences are clean", () => {
    expect(literalClean({ clinicianSay: "Dr. Lee here. What would you like to start with?" })).toBe(true);
  });
  it("SEEDED BAD: a 16-word sentence is not clean", () => {
    expect(literalClean({ clinicianSay: "I would like to talk to you about the many things that have been bothering you lately at home." })).toBe(false);
  });
  it("SEEDED BAD: an idiom is not clean", () => {
    expect(literalClean({ script: "I feel under the weather." })).toBe(false);
  });
  it("an empty reply is not clean", () => {
    expect(literalClean({ clinicianSay: "" })).toBe(false);
  });
  it("the unconfirmed echo of a rejected line does not count against the reply", () => {
    const body = { items: [{ section: "discussed", text: "Ear pain.", evidence: ["l1"] }], unconfirmed: ["I could not confirm this: " + "word ".repeat(30)] };
    expect(literalClean(body)).toBe(true);
  });
});
