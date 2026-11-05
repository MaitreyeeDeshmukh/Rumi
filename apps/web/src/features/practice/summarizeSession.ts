import type { HelpLevel, PlanItem, PracticeSession, VisitPlan } from '../shared/types';
import { FOCUS_LABEL, itemsForFocus } from './labels';
export interface SessionSummary {
  saidMyself: number; saidWithHelp: number; total: number; helpCount: number; focusLabel: string;
  items: { item: PlanItem; covered: boolean; level: HelpLevel }[];
}
export function summarizeSession(s: PracticeSession, plan: VisitPlan): SessionSummary {
  const covered = new Set(s.planId === plan.id ? s.coveredItemIds : []);
  const items = itemsForFocus(plan, s.focus).map((item) => ({ item, covered: covered.has(item.id), level: s.helpLevelUsed[item.id] ?? 0 }));
  const saidMyself = items.filter((i) => i.covered && i.level === 0).length;
  return { items, saidMyself, saidWithHelp: items.filter((i) => i.covered && i.level > 0).length,
    total: items.length, helpCount: s.helpCount, focusLabel: FOCUS_LABEL[s.focus] };
}
