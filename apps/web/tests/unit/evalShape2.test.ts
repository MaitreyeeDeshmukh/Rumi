import { describe, expect, it } from "vitest";
import { buildCases } from "../evals/cases";
import { loadAll } from "../evals/data/schema";
import { MAX_CHARS, checkShape, genericFailures, isRefusalOnly, looksEnglish } from "../evals/scorers/shape";
import type { Arm, EvalCase } from "../evals/types";

const cases = buildCases(loadAll(), "harness");
const byId = (id: string): EvalCase => cases.find((c) => c.id === id) as EvalCase;
const fail = (id: string, body: unknown, arm: Arm = "harness") => checkShape(byId(id), arm, body).failures.join(" | ");
const planReply = (concern: string, items: { text: string; source?: string }[]) => ({
  plan: { id: "p", title: "Visit plan", createdAt: "x", mainConcern: concern, symptomsInMyWords: [], items: items.map((i, n) => ({ id: `q${n + 1}`, text: i.text, kind: "concern", source: i.source ?? "user", enabled: true })) },
});
const say = (clinicianSay: string, isLastTurn = false) => ({ clinicianSay, coveredItemIds: [] as string[], isLastTurn });
const script = (s: string, blanks: string[] = []) => ({ script: s, blanks });

describe("E2-3: schema-valid English junk is not on-task", () => {
  it("plan: an item that is mostly words the user never said fails; two shared words or half of its own words pass", () => {
    expect(fail("plan:p06", planReply("Ear pain on the left.", [{ text: "ear banana window purple" }]))).toMatch(/is not drawn from the input/);
    expect(fail("plan:p06", planReply("Ear pain on the left.", [{ text: "Ear pain on the left side." }]))).toBe("");
    expect(fail("plan:p06", planReply("Ear pain.", [{ text: "Ear pain." }, { text: "Left side purple" }]))).toBe("");
    expect(fail("plan:p06", planReply("Ear pain.", [{ text: "Ear pain." }, { text: "Fluffy purple window banana" }]))).toMatch(/is not drawn/);
  });
  it("plan: a suggested item (a generic detail question) is not held to the input", () => {
    expect(fail("scenario:sc01", planReply("weak", [{ text: "weak" }, { text: "How long has it been?", source: "suggested" }]))).toBe("");
  });
  it("plan: no item at all shares a word with the input", () => {
    expect(fail("plan:p06", planReply("Ear pain.", [{ text: "Quarterly taxes" }]))).toMatch(/no item shares a content word/);
  });
  it("practice: a question unrelated to the plan, the focus or the last user turn fails; generic openers and related questions pass", () => {
    expect(fail("practice:pr01", say("Do you enjoy football on weekends?"))).toMatch(/nothing to do with the plan/);
    expect(fail("practice:pr01", say("How is your knee on the stairs?"))).toBe("");
    expect(fail("practice:pr01", say("What brings you in today?"))).toBe("");
    expect(fail("practice:pr04", say("Who writes the instructions down for you?"))).toBe("");
    expect(fail("scenario:sc05", say("Do you enjoy football on weekends?"))).toMatch(/nothing to do/);
  });
  it("sayit L2: trivial blanks fail; a blank must be a question-word phrase and the sentence must carry a fact from the input", () => {
    expect(fail("sayit:s06", script("I [x] because [y].", ["x", "y"]))).toMatch(/not a real question word phrase/);
    expect(fail("sayit:s06", script("[a][b][c]", ["a", "b", "c"]))).toMatch(/not a real question word phrase/);
    expect(fail("sayit:s06", script("The green table is [how long].", ["how long"]))).toMatch(/carries no fact/);
    expect(fail("sayit:s06", script("I get dizzy [how long].", ["how long"]))).toBe("");
  });
  it("sayit L3: a complete sentence about something else fails; a fact or the generic unsure family passes", () => {
    expect(fail("sayit:s11", script("The green table sings quietly."))).toMatch(/shares nothing with the input facts/);
    expect(fail("sayit:s11", script("I get dizzy when I stand up."))).toBe("");
    expect(fail("sayit:s11", script("I am not sure how to say this. Can you ask me one question at a time?"))).toBe("");
  });
  it("recap: an item that shares no content word with the lines it cites fails", () => {
    const body = (text: string) => ({ items: [{ section: "discussed", text, evidence: ["l2"] }], unconfirmed: [], planStatus: [], dropped: 0 });
    expect(fail("recap:r01", body("Purple bananas were discussed at length."))).toMatch(/shares no content word with the lines it cites/);
    expect(fail("recap:r01", body("It hurts when I lift my arm."))).toBe("");
  });
  it("refusal rewordings are refusal-only; real symptoms that start with 'I cannot' are not", () => {
    for (const t of ["That is not something I can do.", "Not able to help with that.", "I would rather not.", "I’m not going to do that.", "No, I won't answer that.", "I can't help with that."]) {
      expect(isRefusalOnly(t), t).toBe(true);
    }
    for (const t of ["I cannot sleep and my mind races at night.", "I don't know what to say.", "I can't give medical advice. What else would you like to tell me?"]) {
      expect(isRefusalOnly(t), t).toBe(false);
    }
    expect(fail("practice:pr01", say("Not able to help with that."))).toMatch(/refusal_only/);
  });
});

describe("E2-4: a positive English signal is required", () => {
  it.each([
    ["Dutch", "Ik heb pijn in mijn schouder als ik mijn arm optil"],
    ["Indonesian", "Saya sakit bahu ketika mengangkat tangan hari ini"],
    ["Turkish", "Kolumu kaldırdığımda omzum ağrıyor"],
    ["Polish", "Boli mnie ramię gdy podnoszę rękę"],
    ["Swahili", "Bega langu linauma ninapoinua mkono wangu leo"],
    ["short French", "J'ai mal à l'épaule"],
    ["mixed English/French", "I want to tell you about la douleur dans mon épaule gauche"],
  ])("%s is not English", (_name, text) => {
    expect(looksEnglish(text)).toBe(false);
  });
  it("English passes, including a terse echo of the user's own words, but not a terse foreign string with no overlap", () => {
    expect(looksEnglish("Which part of the visit do you want to ask about?")).toBe(true);
    expect(looksEnglish("ear pain left side 4 days", "ear pain left side 4 days")).toBe(true);
    expect(looksEnglish("ear pain left side 4 days")).toBe(false);
  });
  it("the check is applied to the reply, with the request as the user's own words", () => {
    expect(fail("sayit:s06", script("Ik heb pijn in mijn schouder als ik mijn arm optil [how long].", ["how long"]))).toMatch(/language/);
  });
});

describe("E2-7: harness-only rules do not count against the baseline", () => {
  it("say-it level rules come back as info for the baseline and as failures for the harness", () => {
    const body = script("I get dizzy when I stand up.");
    const h = checkShape(byId("sayit:s01"), "harness", body);
    const b = checkShape(byId("sayit:s01"), "baseline", body);
    expect(h.failures.join(" ")).toMatch(/L1: no question/);
    expect(b.failures).toEqual([]);
    expect(b.info.join(" ")).toMatch(/L1: no question/);
  });
  it("generic rules (schema, language, refusal) still count for the baseline", () => {
    const b = checkShape(byId("sayit:s01"), "baseline", script("I am sorry, I cannot help with that."));
    expect(b.failures.join(" ")).toMatch(/refusal_only/);
  });
});

describe("E2-12: exact thresholds", () => {
  it("per-task length ceilings are exact (plan 4000, practice 700, sayit 600, recap 8000)", () => {
    expect(MAX_CHARS).toEqual({ plan: 4000, practice: 700, sayit: 600, recap: 8000 });
    const words = (n: number) => Array.from({ length: Math.ceil(n / 6) }, (_, i) => `w${(i % 40).toString(36).padEnd(4, "z")}`).join(" ").slice(0, n);
    const lenFail = (task: "practice" | "sayit", n: number) => genericFailures(task, "baseline", task === "practice" ? say(words(n)) : script(words(n)), false, words(n)).join("|");
    expect(lenFail("practice", 700)).not.toMatch(/characters is over/);
    expect(lenFail("practice", 701)).toMatch(/701 characters is over 700/);
    expect(lenFail("sayit", 600)).not.toMatch(/characters is over/);
    expect(lenFail("sayit", 601)).toMatch(/601 characters is over 600/);
  });
  it("the plan 'no item shares' and 'mainConcern shares' messages exist for the right cases", () => {
    expect(fail("plan:p06", planReply("Taxes.", [{ text: "Ear pain on the left." }]))).toMatch(/mainConcern shares no content word with the input/);
    expect(fail("plan:p06", planReply("Ear pain.", [{ text: "Quarterly taxes" }]))).toMatch(/no item shares a content word with the input/);
  });
});

describe("shape: round-3 mutants", () => {
  it("a generic opener is accepted even when it shares nothing with the plan, the focus or the user's last turn", () => {
    expect(fail("practice:pr05", say("What else would you like to tell me?"))).toBe("");
    expect(fail("practice:pr05", say("How long has it been going on?"))).toBe("");
    expect(fail("practice:pr05", say("Do you enjoy football on weekends?"))).toMatch(/nothing to do/);
  });
  it("level-2 blanks must be question-word phrases: 'some thing' and one letter both fail, 'who' passes", () => {
    expect(fail("sayit:s06", script("I get dizzy [some thing].", ["some thing"]))).toMatch(/not a real question word phrase/);
    expect(fail("sayit:s06", script("I get dizzy [x].", ["x"]))).toMatch(/not a real question word phrase/);
    expect(fail("sayit:s06", script("I get dizzy [when it started].", ["when it started"]))).toBe("");
  });
  it("accented or extended Latin letters mark a reply as non-English even with English words around them", () => {
    expect(looksEnglish("I want to tell you about my épaule épaule épaule")).toBe(false);
    expect(looksEnglish("I want to tell you about my shoulder pain today")).toBe(true);
  });
});
