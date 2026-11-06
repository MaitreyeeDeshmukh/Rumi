import { describe, expect, it } from "vitest";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { composeBlank, helpAnswer, uncovered } from "@/features/adapters/practice";

describe("uncovered", () => {
  it("lists the lines still to say, in plan order", () => {
    expect(uncovered(DEMO_PLAN, "whole", ["q1"]).map((i) => i.id)).toEqual(["q2", "q3", "q4"]);
  });
});

describe("helpAnswer", () => {
  const item = DEMO_PLAN.items[1]; // "I want to ask why I get these headaches."
  it("level 1 is a hint, level 3 the whole sentence", () => {
    expect(helpAnswer(item, 1).text).not.toContain("headaches");
    expect(helpAnswer(item, 3).text).toBe("I want to ask why I get these headaches.");
  });
  it("level 2 leaves the last word blank and keeps the ending mark", () => {
    const a = helpAnswer(item, 2);
    expect(a.prefix).toBe("I want to ask why I get these");
    expect(a.suffix).toBe(".");
    expect(composeBlank(a, " headaches ")).toBe("I want to ask why I get these headaches.");
  });
});
