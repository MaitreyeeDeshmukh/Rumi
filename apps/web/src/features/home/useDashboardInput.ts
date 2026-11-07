import { HELP_KINDS, helpTrend, type HelpLevel, type ItemKind } from "@/features/home/helpLevel";
import type { DashboardState } from "@/features/home/nextStep";
import { FOCUS_LABEL } from "@/features/practice/labels";
import { startLevelFor } from "@/features/adapters/startLevelFor";
import { summarizeSession } from "@/features/practice/summarizeSession";
import { splitAppointments } from "@/features/appointments/appointments";
import type { Appointment, PracticeSession } from "@/features/shared/types";
import { useRumi } from "@/lib/rumiActive";
import { browserStorage } from "@/lib/storage";

export type HomeViewProps = {
  state: DashboardState;
  name: string | null;
  helpLevels: Partial<Record<ItemKind, HelpLevel>> | null;
  lastPractice: {
    focusLabel: string;
    saidMyself: number;
    saidWithHelp: number;
    total: number;
    trend: string | null;
  } | null;
  memoryOn: boolean;
  storageOk: boolean;
  /** The soonest visit that has not happened yet. Absent or null: none booked. */
  nextAppointment?: Appointment | null;
};

/** The most help the person used in one practice. */
const mostHelp = (s: PracticeSession): HelpLevel => Math.max(0, ...Object.values(s.helpLevelUsed)) as HelpLevel;

/** The summary when the plan is gone: counts of the lines the person covered. */
function withoutPlan(s: PracticeSession) {
  // Help is stored per kind of plan line, so without the plan the best guess is: each help request covers one line.
  const alone = Math.max(0, s.coveredItemIds.length - Math.max(0, Math.floor(s.helpCount)));
  return {
    saidMyself: alone,
    saidWithHelp: s.coveredItemIds.length - alone,
    total: s.coveredItemIds.length,
    helpCount: s.helpCount,
    focusLabel: FOCUS_LABEL[s.focus],
  };
}

/** Everything the dashboard shows, worked out from the stored state. `ready` is false until the browser has loaded it. */
export function useDashboardInput(): { ready: boolean; props: HomeViewProps } {
  const { state, hydrated, lastSave, readOnly } = useRumi();
  const { plan, supportCard, sessions, recap, settings } = state;
  const last = sessions.at(-1);
  const before = sessions.at(-2);
  // A card with no lines is not a card yet. Sessions without a plan (the plan was removed) still show what was said.
  const card = supportCard && Array.isArray((supportCard as { items?: unknown }).items) && (supportCard as { items: unknown[] }).items.length > 0 ? supportCard : null;
  // A practice made from a booked visit, a recording or a file used other lines, so it is not scored against my plan.
  const summary = last ? (plan && last.planId === plan.id ? summarizeSession(last, plan) : withoutPlan(last)) : null;

  return {
    ready: hydrated,
    props: {
      state: { plan: plan ?? null, supportCard: card, sessions, recap: recap ?? null },
      name: settings.name.trim() || null,
      helpLevels: sessions.length
        ? Object.fromEntries(HELP_KINDS.map(({ kind }) => [kind, startLevelFor(state, kind)]))
        : null,
      lastPractice:
        summary && last
          ? { ...summary, trend: before ? helpTrend(mostHelp(before), mostHelp(last)) : null }
          : null,
      nextAppointment: splitAppointments(state.appointments ?? [], new Date()).upcoming[0] ?? null,
      memoryOn: settings.memoryOptIn,
      storageOk: browserStorage() !== null && lastSave.ok && !readOnly,
    },
  };
}
