import type { HelpLevel } from '../shared/types';
// features/practice/nextStartLevel.ts
export interface HelpHistoryEntry { level: HelpLevel; stuck: boolean }
/** Oldest first. Level 0 = the user said it alone. The Help button's first answer is max(1, result). */
export function nextStartLevel(history: HelpHistoryEntry[]): HelpLevel {
  const last = history.at(-1);
  if (!last) return 1;
  if (last.stuck && history.at(-2)?.stuck) return 1;
  return Math.max(0, last.level - 1) as HelpLevel;
}
