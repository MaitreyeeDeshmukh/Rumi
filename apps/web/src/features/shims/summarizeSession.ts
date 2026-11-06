// swap when the lane merges (src/features/practice/summarizeSession.ts)
import { FOCUS_LABEL, itemsForFocus } from "@/features/shims/focus";
import type { PracticeSession, VisitPlan } from "@/features/shims/types";

export interface SessionSummary {
  saidMyself: number;
  saidWithHelp: number;
  total: number;
  helpCount: number;
  focusLabel: string;
}

export function summarizeSession(s: PracticeSession, plan: VisitPlan): SessionSummary {
  const relevant = itemsForFocus(plan, s.focus).map((i) => i.id);
  const covered = s.coveredItemIds.filter((id) => relevant.includes(id));
  const alone = covered.filter((id) => (s.helpLevelUsed[id] ?? 0) === 0);
  return {
    saidMyself: alone.length,
    saidWithHelp: covered.length - alone.length,
    total: relevant.length,
    helpCount: s.helpCount,
    focusLabel: FOCUS_LABEL[s.focus],
  };
}
