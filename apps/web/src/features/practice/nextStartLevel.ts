import type { HelpLevel } from "@/features/shared/types";

export interface HelpHistoryEntry {
  level: HelpLevel;
  stuck: boolean;
}

/** A level the code can trust: a whole number, clamped to 0..3. Anything else (NaN, a string, 1.5) is unknown. */
const clean = (level: unknown): HelpLevel | undefined =>
  typeof level === "number" && Number.isInteger(level) ? (Math.min(3, Math.max(0, level)) as HelpLevel) : undefined;

/**
 * Oldest first. Level 0 means the user said it alone. The Help button's first answer is max(1, result).
 * Help fades one step after each answer; two stuck answers in a row, or any unreadable entry, restart at 1.
 */
export function nextStartLevel(history: readonly HelpHistoryEntry[]): HelpLevel {
  const last = Array.isArray(history) ? history.at(-1) : undefined;
  if (!last) return 1;
  const level = clean(last.level);
  if (level === undefined || (last.stuck === true && history.at(-2)?.stuck === true)) return 1;
  return Math.max(0, level - 1) as HelpLevel;
}
