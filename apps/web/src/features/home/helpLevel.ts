import { HELP_KIND_LABELS, HELP_LEVEL_NEEDED, HELP_LEVEL_WORDS, TREND } from "@/content/dashboard";

export type HelpLevel = 0 | 1 | 2 | 3;
export type ItemKind = "concern" | "question" | "accommodation";

export const helpLevelWord = (level: HelpLevel): string => HELP_LEVEL_WORDS[level];

/** The three plan item kinds, in the order the dashboard lists them. */
export const HELP_KINDS: readonly { kind: ItemKind; label: string }[] = (
  Object.keys(HELP_KIND_LABELS) as ItemKind[]
).map((kind) => ({ kind, label: HELP_KIND_LABELS[kind] }));

/** A sentence about how the help needed changed between two practices; null when it stayed the same. */
export function helpTrend(before: HelpLevel, after: HelpLevel): string | null {
  if (before === after) return null;
  return `${TREND.before} ${HELP_LEVEL_NEEDED[before]}. ${TREND.after} ${HELP_LEVEL_NEEDED[after]}.`;
}
