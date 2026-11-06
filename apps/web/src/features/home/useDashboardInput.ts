import { HELP_KINDS, helpTrend, type HelpLevel, type ItemKind } from "@/features/home/helpLevel";
import type { DashboardState } from "@/features/home/nextStep";
import { FOCUS_LABEL } from "@/features/shims/focus";
import { startLevelFor } from "@/features/shims/startLevelFor";
import { summarizeSession } from "@/features/shims/summarizeSession";
import type { PracticeSession } from "@/features/shims/types";
import { useRumi } from "@/lib/rumiActive";
import { storageWorks } from "@/lib/rumiStore";

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
};

/** The most help the person used in one practice. */
const mostHelp = (s: PracticeSession): HelpLevel => Math.max(0, ...Object.values(s.helpLevelUsed)) as HelpLevel;

/** The summary when the plan is gone: counts of the lines the person covered. */
function withoutPlan(s: PracticeSession) {
  const alone = s.coveredItemIds.filter((id) => (s.helpLevelUsed[id] ?? 0) === 0).length;
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
  const { state, hydrated, persisted } = useRumi();
  const { plan, supportCard, sessions, recap, settings } = state;
  const last = sessions.at(-1);
  const before = sessions.at(-2);
  // A card with no lines is not a card yet. Sessions without a plan (the plan was removed) still show what was said.
  const card = supportCard && Array.isArray((supportCard as { items?: unknown }).items) && (supportCard as { items: unknown[] }).items.length > 0 ? supportCard : null;
  const summary = last ? (plan ? summarizeSession(last, plan) : withoutPlan(last)) : null;

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
      memoryOn: settings.memoryOptIn,
      storageOk: storageWorks() && persisted,
    },
  };
}
