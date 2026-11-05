import { focusLabel, itemsForFocus } from "@/features/practice/labels";
import type { PracticeSession, VisitPlan } from "@/features/shared/types";

export interface SessionSummary {
  saidMyself: number;
  saidWithHelp: number;
  total: number;
  helpCount: number;
  focusLabel: string;
}

/**
 * What the user covered in this session, for the summary line "You said 3 of 4 things yourself." Never a score.
 * Help is recorded per plan-item kind (07 section 1.6), so an item counts as "with help" when its kind used help.
 */
export function summarizeSession(s: PracticeSession, plan: VisitPlan): SessionSummary {
  const relevant = itemsForFocus(plan, s.focus);
  const said = new Set(s.coveredItemIds);
  const covered = relevant.filter((i) => said.has(i.id));
  const used = s.helpLevelUsed ?? {};
  const alone = covered.filter((i) => !(Object.hasOwn(used, i.kind) && used[i.kind]));
  const helpCount = Number.isFinite(s.helpCount) ? Math.max(0, Math.floor(s.helpCount)) : 0;
  return { saidMyself: alone.length, saidWithHelp: covered.length - alone.length, total: relevant.length, helpCount, focusLabel: focusLabel(s.focus) };
}
