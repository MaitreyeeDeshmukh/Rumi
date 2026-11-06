import { describe, expect, it } from "vitest";
import { nextStep, stepStatus, type DashboardState } from "@/features/home/nextStep";

const item = { enabled: true };
const plan = { mainConcern: "Headaches", items: [item] };
const none: DashboardState = { plan: null, supportCard: null, sessions: [], recap: null };
const state = (patch: Partial<DashboardState>): DashboardState => ({ ...none, ...patch });

describe("nextStep", () => {
  it("no plan: make the plan", () => {
    expect(nextStep(none)).toEqual({
      id: "make_plan",
      href: "/get-ready",
      label: "Make your plan",
      sentence: "Rumi will turn your words into a plan. You can change everything.",
    });
  });

  it("a plan with zero items counts as no plan", () => {
    expect(nextStep(state({ plan: { mainConcern: "x", items: [] } })).id).toBe("make_plan");
  });

  it("plan but no support card: finish the card", () => {
    expect(nextStep(state({ plan }))).toEqual({
      id: "finish_card",
      href: "/get-ready",
      label: "Finish your support card",
      sentence: "Pick how you like to be supported.",
    });
  });

  it("plan and card but no practice: start practice", () => {
    expect(nextStep(state({ plan, supportCard: {} }))).toEqual({
      id: "practice",
      href: "/practice",
      label: "Start practice",
      sentence: "Talk with a practice clinician. This is not a real doctor.",
    });
  });

  it("practiced but no recap: try the sample visit", () => {
    expect(nextStep(state({ plan, supportCard: {}, sessions: [{}] }))).toEqual({
      id: "remember",
      href: "/remember",
      label: "Try the sample visit",
      sentence: "See what Rumi can do with a made-up visit.",
    });
  });

  it("everything done: see the kit", () => {
    expect(nextStep(state({ plan, supportCard: {}, sessions: [{}], recap: {} }))).toEqual({
      id: "kit",
      href: "/kit",
      label: "See your kit",
      sentence: "Your plan and support card are in one place.",
    });
  });

  it("the first match wins even when later things exist", () => {
    expect(nextStep(state({ sessions: [{}], recap: {} })).id).toBe("make_plan");
  });
});

describe("stepStatus", () => {
  it("new user", () => {
    expect(stepStatus(none)).toEqual({ getReady: "Not started", practice: "Not started", remember: "Not started" });
  });
  it("plan only", () => {
    expect(stepStatus(state({ plan }))).toEqual({ getReady: "In progress", practice: "Not started", remember: "Not started" });
  });
  it("plan and card", () => {
    expect(stepStatus(state({ plan, supportCard: {} }))).toEqual({
      getReady: "Done",
      practice: "Not started",
      remember: "Not started",
    });
  });
  it("plus a session", () => {
    expect(stepStatus(state({ plan, supportCard: {}, sessions: [{}] }))).toEqual({
      getReady: "Done",
      practice: "Done",
      remember: "Not started",
    });
  });
  it("plus a recap", () => {
    expect(stepStatus(state({ plan, supportCard: {}, sessions: [{}], recap: {} }))).toEqual({
      getReady: "Done",
      practice: "Done",
      remember: "Done",
    });
  });
});
