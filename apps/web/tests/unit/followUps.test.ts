import { describe, expect, it } from "vitest";
import { MAX_FOLLOW_UPS, nextFollowUps } from "@/features/getReady/followUps";

const ids = (text: string) => nextFollowUps(text).map((q) => q.id);

describe("Get ready follow-up questions", () => {
  it("asks what the visit is about when the words have nothing to build on", () => {
    expect(ids("ok")[0]).toBe("reason");
    expect(ids("hi")[0]).toBe("reason");
  });

  it("asks about what is missing, in order, and never more than three", () => {
    const q = ids("My knee hurts");
    expect(q.length).toBeLessThanOrEqual(MAX_FOLLOW_UPS);
    expect(q[0]).toBe("duration");
  });

  it("does not ask what the person already said", () => {
    const q = ids("My knee has hurt for two weeks and I am worried it is serious. I want a scan.");
    expect(q).not.toContain("duration");
    expect(q).not.toContain("worry");
    expect(q).not.toContain("goal");
  });

  it("asks nothing when plenty was written", () => {
    expect(nextFollowUps(Array.from({ length: 70 }, () => "knee").join(" "))).toEqual([]);
  });

  it("every question has a question text and tap answers that are the person's own sentences", () => {
    for (const q of nextFollowUps("My knee hurts")) {
      expect(q.question.endsWith("?")).toBe(true);
      expect(q.chips.length).toBeGreaterThanOrEqual(3);
      for (const c of q.chips) expect(c.endsWith(".")).toBe(true);
    }
  });
});
