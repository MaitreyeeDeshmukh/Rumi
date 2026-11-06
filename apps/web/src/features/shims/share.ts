// swap when the lane merges (src/features/share/buildShareText.ts). Same signature: (selection, state) => string.
import { SHARE } from "@/content/share";
import type { PlanItem, RumiState } from "@/features/shims/types";

export const SHARE_IDS = ["plan", "card", "discussed", "instructions", "medications", "next_steps", "said"] as const;
export type ShareId = (typeof SHARE_IDS)[number];
export type ShareSelection = Partial<Record<ShareId, boolean>>;

const bullet = (text: string): string => `- ${text}`;

/** The lines of one section. Empty when the person has no data for it. */
function linesOf(id: ShareId, state: RumiState): string[] {
  const { plan, supportCard, recap } = state;
  if (id === "plan") {
    if (!plan) return [];
    const kinds = Object.keys(SHARE.planKinds) as PlanItem["kind"][];
    return [
      ...(plan.mainConcern ? [`${SHARE.mainConcern}: ${plan.mainConcern}`] : []),
      ...(plan.symptomsInMyWords.length ? [`${SHARE.inMyWords}: ${plan.symptomsInMyWords.join(" ")}`] : []),
      ...kinds.flatMap((kind) => {
        const items = plan.items.filter((i) => i.enabled && i.kind === kind);
        return items.length ? [`${SHARE.planKinds[kind]}:`, ...items.map((i) => bullet(i.text))] : [];
      }),
    ];
  }
  if (id === "card") return (supportCard?.items ?? []).filter((i) => i.enabled).map((i) => bullet(i.text));
  if (id === "said") {
    const names = Object.keys(SHARE.status) as (keyof typeof SHARE.status)[];
    return names.flatMap((status) => {
      const texts = (recap?.planStatus ?? [])
        .filter((p) => p.status === status)
        .map((p) => plan?.items.find((i) => i.id === p.itemId)?.text)
        .filter((t): t is string => Boolean(t));
      return texts.length ? [`${SHARE.status[status]}:`, ...texts.map(bullet)] : [];
    });
  }
  return (recap?.items ?? []).filter((i) => i.section === id).map((i) => bullet(i.text));
}

/** Which sections have something to share. A section without data cannot be chosen. */
export function availableShare(state: RumiState): Record<ShareId, boolean> {
  return Object.fromEntries(SHARE_IDS.map((id) => [id, linesOf(id, state).length > 0])) as Record<ShareId, boolean>;
}

/** The exact text the screen shows and copies. Empty when nothing usable is selected. */
export function buildShareText(selection: ShareSelection, state: RumiState): string {
  return SHARE_IDS.filter((id) => selection[id])
    .map((id) => ({ id, lines: linesOf(id, state) }))
    .filter((s) => s.lines.length > 0)
    .map((s) => [SHARE.sections[s.id], ...s.lines].join("\n"))
    .join("\n\n");
}
