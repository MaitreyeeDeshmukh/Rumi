import { NEXT_STEPS, STATUS } from "@/content/dashboard";

/** The parts of the stored state the dashboard reads. */
export type DashboardState = {
  plan: { mainConcern: string; items: { enabled: boolean }[] } | null;
  supportCard: object | null;
  sessions: unknown[];
  recap: object | null;
};

export type NextStepId = keyof typeof NEXT_STEPS;
export type Status = (typeof STATUS)[keyof typeof STATUS];

const hasPlan = (s: DashboardState): boolean => s.plan !== null && s.plan.items.length > 0;

/** What to do next. The first rule that matches wins. */
export function nextStep(s: DashboardState): { id: NextStepId; href: string; label: string; sentence: string } {
  const id: NextStepId = !hasPlan(s)
    ? "make_plan"
    : !s.supportCard
      ? "finish_card"
      : s.sessions.length === 0
        ? "practice"
        : !s.recap
          ? "remember"
          : "kit";
  return { id, ...NEXT_STEPS[id] };
}

/** Where the person is in each of the three steps, in words. */
export function stepStatus(s: DashboardState): { getReady: Status; practice: Status; remember: Status } {
  const plan = hasPlan(s);
  return {
    getReady: plan && s.supportCard ? STATUS.done : plan ? STATUS.inProgress : STATUS.notStarted,
    practice: s.sessions.length > 0 ? STATUS.done : STATUS.notStarted,
    remember: s.recap ? STATUS.done : STATUS.notStarted,
  };
}
