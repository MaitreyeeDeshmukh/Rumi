import { describe, expect, it } from "vitest";
import { VisitPlanSchema } from "@/features/shared/schemas";
import { allOn, generalPlan, planFromAppointment, preview } from "@/features/practice/sources";
import type { Appointment, Visit } from "@/features/shared/types";

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: "a1",
  care: "primary",
  providerName: "Dr. Rivera",
  clinic: "Clinic",
  date: "2026-10-01",
  time: "09:00",
  reason: "My stomach hurts after meals.",
  status: "confirmed",
  createdAt: "2026-09-20T10:00:00.000Z",
  questions: ["Do I need a test?"],
  bring: ["My card"],
  symptoms: ["I feel sick at night."],
  ...over,
});

describe("practice sources", () => {
  it("the general plan is a valid plan with every kind of line on", () => {
    const p = generalPlan(new Date("2026-11-06T00:00:00Z"));
    expect(VisitPlanSchema.safeParse(p).success).toBe(true);
    expect(new Set(p.items.map((i) => i.kind))).toEqual(new Set(["concern", "question", "accommodation"]));
    expect(p.items.every((i) => i.enabled)).toBe(true);
  });

  it("a booked visit becomes a valid plan from its reason, symptoms and questions", () => {
    const p = planFromAppointment(appt());
    expect(p).not.toBeNull();
    expect(VisitPlanSchema.safeParse(p).success).toBe(true);
    expect(p?.mainConcern).toBe("My stomach hurts after meals.");
    expect(p?.items.map((i) => i.kind)).toEqual(["concern", "concern", "question"]);
    expect(p?.items.map((i) => i.text)).toContain("Do I need a test?");
  });

  it("a visit with no notes gives no plan", () => {
    expect(planFromAppointment(appt({ reason: " ", questions: [], symptoms: [] }))).toBeNull();
  });

  it("long notes stay inside the plan limits and ids stay unique", () => {
    const many = Array.from({ length: 20 }, (_, n) => `Question number ${n}?`);
    const p = planFromAppointment(appt({ questions: many, reason: "x".repeat(500) }));
    expect(VisitPlanSchema.safeParse(p).success).toBe(true);
    expect(p?.items.length).toBeLessThanOrEqual(12);
  });

  it("allOn switches every line on", () => {
    const base = generalPlan();
    const off = { ...base, items: base.items.map((i) => ({ ...i, enabled: false })) };
    expect(allOn(off).items.every((i) => i.enabled)).toBe(true);
  });

  it("a preview is one short line", () => {
    const v: Visit = { id: "v1", createdAt: "2026-10-01T10:00:00.000Z", text: "Line one\n\nLine two ".repeat(20) };
    const t = preview(v, 30);
    expect(t.length).toBeLessThanOrEqual(33);
    expect(t).not.toContain("\n");
  });
});
