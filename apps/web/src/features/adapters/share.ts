// Adapts the share screen (seven checkboxes) to the real text builder.
import { EMPTY_SELECTION, buildShareText as buildReal, type ShareSelection as RealSelection } from "@/features/share/buildShareText";
import type { RecapSection, RumiState } from "@/features/shared/types";

export const SHARE_IDS = ["plan", "card", "discussed", "instructions", "medications", "next_steps", "said"] as const;
export type ShareId = (typeof SHARE_IDS)[number];
export type ShareSelection = Partial<Record<ShareId, boolean>>;

const toReal = (sel: ShareSelection): RealSelection => ({
  ...EMPTY_SELECTION,
  plan: !!sel.plan,
  supportCard: !!sel.card,
  saidMyself: !!sel.said,
  recapSections: Object.fromEntries((["discussed", "instructions", "medications", "next_steps"] as RecapSection[]).filter((id) => sel[id]).map((id) => [id, true])),
});

/** The exact text the screen shows and copies. Empty when nothing usable is selected. */
export const buildShareText = (selection: ShareSelection, state: RumiState): string => buildReal(toReal(selection), state);

/** Which sections have something to share. A section without data cannot be chosen. */
export const availableShare = (state: RumiState): Record<ShareId, boolean> =>
  Object.fromEntries(SHARE_IDS.map((id) => [id, buildShareText({ [id]: true }, state).trim().length > 0])) as Record<ShareId, boolean>;
