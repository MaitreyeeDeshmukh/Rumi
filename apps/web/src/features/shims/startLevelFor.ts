// swap when the lane merges (src/features/practice/nextStartLevel.ts and src/features/memory/persona.ts)
import type { HelpLevel, PlanItem, RumiState } from "@/features/shims/types";

export interface HelpHistoryEntry {
  level: HelpLevel;
  stuck: boolean;
}

/** Oldest first. Level 0 = the person said it alone. */
export function nextStartLevel(history: HelpHistoryEntry[]): HelpLevel {
  const last = history.at(-1);
  if (!last) return 1;
  if (last.stuck && history.at(-2)?.stuck) return 1;
  return Math.max(0, last.level - 1) as HelpLevel;
}

/** One entry per practice that had a line of this kind: the highest help level used. Level 3 counts as stuck. */
function helpHistoryFor(state: RumiState, kind: PlanItem["kind"]): HelpHistoryEntry[] {
  const ids = new Set((state.plan?.items ?? []).filter((i) => i.kind === kind).map((i) => i.id));
  return state.sessions.flatMap((s) => {
    const levels = Object.entries(s.helpLevelUsed ?? {}).filter(([id]) => ids.has(id));
    if (levels.length === 0) return [];
    const level = Math.max(...levels.map(([, l]) => l)) as HelpLevel;
    return [{ level, stuck: level === 3 }];
  });
}

export const startLevelFor = (state: RumiState, kind: PlanItem["kind"]): HelpLevel =>
  nextStartLevel(helpHistoryFor(state, kind));
