import { focusLabel, itemsForFocus } from "@/features/practice/labels";
import type { PracticeSession, VisitPlan } from "@/features/shared/types";

export interface SessionSummary {
  saidMyself: number;
  saidWithHelp: number;
  total: number;
  helpCount: number;
  focusLabel: string;
  /** True when no plan item belongs to the chosen focus (all disabled, or none of that kind). The UI shows a different line, not "0 of 0". */
  empty: boolean;
}

/**
 * What the user covered in this session, for the summary line "You said 3 of 4 things yourself." Never a score.
 * Help is recorded per plan-item kind (07 section 1.6), so an item counts as "with help" when its kind used help.
 * Rule for the UI: the summary is a snapshot taken when the user presses End. Un-ticking or editing plan items afterwards
 * does not change a summary that was already shown; a new practice makes a new summary.
 */
export function summarizeSession(s: PracticeSession, plan: VisitPlan): SessionSummary {
  const relevant = itemsForFocus(plan, s.focus);
  const said = new Set(s.coveredItemIds);
  const covered = relevant.filter((i) => said.has(i.id));
  const used = s.helpLevelUsed ?? {};
  const alone = covered.filter((i) => !(Object.hasOwn(used, i.kind) && used[i.kind]));
  const helpCount = Number.isFinite(s.helpCount) ? Math.max(0, Math.floor(s.helpCount)) : 0;
  return { saidMyself: alone.length, saidWithHelp: covered.length - alone.length, total: relevant.length, empty: relevant.length === 0, helpCount, focusLabel: focusLabel(s.focus) };
}
