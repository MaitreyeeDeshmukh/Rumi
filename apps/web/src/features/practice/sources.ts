/**
 * Where a practice can start from. Every source ends as a VisitPlan, because the practice call works from plan lines.
 * These plans are made for one practice and are not saved as "my plan" (that one comes from Get ready).
 * Pure: no browser, no network. The file and audio reading is in processSource.ts.
 */
import { LIMITS } from "@/features/shared/constants";
import type { Appointment, PlanItem, PlanItemKind, VisitPlan, Visit } from "@/features/shared/types";

export const GENERAL_PLAN_ID = "general";

const line = (id: string, kind: PlanItemKind, text: string): PlanItem => ({ id, kind, text, source: "user", enabled: true });

/** A plan with no personal details, for practicing how a visit goes. */
export function generalPlan(now: Date = new Date()): VisitPlan {
  return {
    id: GENERAL_PLAN_ID,
    title: "General practice",
    createdAt: now.toISOString(),
    mainConcern: "A visit to the doctor",
    symptomsInMyWords: [],
    items: [
      line("g1", "concern", "I want to explain why I came today."),
      line("g2", "concern", "I want to say how long this has been going on."),
      line("g3", "question", "What could be causing this?"),
      line("g4", "question", "What should I do next?"),
      line("g5", "accommodation", "Please speak slowly."),
      line("g6", "accommodation", "Please write the steps down."),
    ],
  };
}

const clip = (text: string, max: number): string => text.trim().slice(0, max);

/**
 * The notes a person prepared for a booked visit, as plan lines: what they said is wrong, the symptoms and the
 * questions. Returns null when the visit has no notes, so the screen can say so instead of starting an empty practice.
 */
export function planFromAppointment(a: Appointment, now: Date = new Date()): VisitPlan | null {
  const items: PlanItem[] = [];
  const reason = clip(a.reason, LIMITS.itemTextMax);
  if (reason) items.push(line("c0", "concern", reason));
  a.symptoms.forEach((s, n) => {
    const text = clip(s, LIMITS.itemTextMax);
    if (text) items.push(line(`c${n + 1}`, "concern", text));
  });
  a.questions.forEach((q, n) => {
    const text = clip(q, LIMITS.itemTextMax);
    if (text) items.push(line(`q${n + 1}`, "question", text));
  });
  if (items.length === 0) return null;
  return {
    id: `appt-${a.id}`.slice(0, 40),
    title: clip(`${a.providerName}`, 80),
    createdAt: now.toISOString(),
    mainConcern: reason || clip(a.symptoms[0] ?? "", LIMITS.concernMax),
    symptomsInMyWords: a.symptoms.map((s) => clip(s, 100)).filter(Boolean).slice(0, 12),
    items: items.slice(0, LIMITS.planItemsMax),
  };
}

/** The lines a plan made by the AI starts with: all on, because the person picked this source to practice with. */
export const allOn = (plan: VisitPlan): VisitPlan => ({ ...plan, items: plan.items.map((i) => ({ ...i, enabled: true })) });

/** A short preview of what was said at a visit, for the list. */
export function preview(visit: Visit, max = 70): string {
  const text = visit.text.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}...`;
}

/** The most text the plan call takes. Longer text is cut, and the screen says so. */
export const RAW_TEXT_MAX = LIMITS.rawTextMax;
