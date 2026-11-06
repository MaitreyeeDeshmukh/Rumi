import { describe, expect, it } from "vitest";
import { DEMO_PLAN } from "@/features/shims/fixtures";
import { composeBlank, helpAnswer, scriptedReply, uncovered } from "@/features/shims/practice";

describe("scriptedReply", () => {
  it("covers one more plan line per answer and ends after the last", () => {
    const first = scriptedReply(DEMO_PLAN, "whole", 1);
    expect(first.coveredItemIds).toEqual(["q1"]);
    expect(first.isLastTurn).toBe(false);
    const final = scriptedReply(DEMO_PLAN, "whole", 4);
    expect(final.coveredItemIds).toEqual(["q1", "q2", "q3", "q4"]);
    expect(final.isLastTurn).toBe(true);
  });

  it("uses only the lines of the chosen part", () => {
    expect(scriptedReply(DEMO_PLAN, "questions", 1).coveredItemIds).toEqual(["q2"]);
    expect(scriptedReply(DEMO_PLAN, "questions", 2).isLastTurn).toBe(true);
  });
});

describe("uncovered", () => {
  it("lists the lines still to say, in plan order", () => {
    expect(uncovered(DEMO_PLAN, "whole", ["q1"]).map((i) => i.id)).toEqual(["q2", "q3", "q4"]);
  });
});

describe("helpAnswer", () => {
  const item = DEMO_PLAN.items[1]; // "Why do I get these headaches?"
  it("level 1 is a hint, level 3 the whole sentence", () => {
    expect(helpAnswer(item, 1).text).not.toContain("headaches");
    expect(helpAnswer(item, 3).text).toBe("Why do I get these headaches?");
  });
  it("level 2 leaves the last word blank and keeps the ending mark", () => {
    const a = helpAnswer(item, 2);
    expect(a.prefix).toBe("Why do I get these");
    expect(a.suffix).toBe("?");
    expect(composeBlank(a, " headaches ")).toBe("Why do I get these headaches?");
  });
});
