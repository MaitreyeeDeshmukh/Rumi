import type { HelpLevel, PlanItem, RumiState } from '../shared/types';
import { nextStartLevel } from './nextStartLevel';
/** Only use sessions for the same plan. Reused q1 IDs do not imply the same goal. */
export function startLevelFor(state: RumiState, kind: PlanItem['kind']): HelpLevel {
  const plan = state.plan;
  if (!plan) return 1;
  const ids = plan.items.filter((i) => i.enabled && i.kind === kind).map((i) => i.id);
  const history = state.sessions.filter((s) => s.planId === plan.id).flatMap((s) => {
    const used = ids.filter((id) => s.coveredItemIds.includes(id) || id in s.helpLevelUsed);
    if (!used.length) return [];
    return [{ level: Math.max(...used.map((id) => s.helpLevelUsed[id] ?? 0)) as HelpLevel,
      stuck: used.every((id) => !s.coveredItemIds.includes(id)) }];
  });
  return nextStartLevel(history);
}
