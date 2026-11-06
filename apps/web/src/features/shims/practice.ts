// swap when the lane merges (src/features/practice/*): the real /api/practice and /api/sayit replies.
// Today callApi answers one fixed fixture, so this file scripts the clinician from the plan, using the plan's lines.
import { z } from "zod";
import { PRACTICE } from "@/content/practice";
import { callApi } from "@/features/shims/callApi";
import { itemsForFocus } from "@/features/shims/focus";
import type { ApiResult, Focus, PlanItem, Turn, VisitPlan } from "@/features/shims/types";

export const PracticeReply = z.object({
  clinicianSay: z.string(),
  coveredItemIds: z.array(z.string()),
  isLastTurn: z.boolean(),
});
export type PracticeReply = z.infer<typeof PracticeReply>;

export const SayItReply = z.object({ script: z.string(), blanks: z.array(z.string()) });

export type HelpLevelShown = 1 | 2 | 3;
/** What the Help me say it sheet shows at one level. Level 2 has the text before a blank, the blank, and what follows it. */
export type HelpAnswer = { level: HelpLevelShown; text: string; prefix: string; suffix: string };

/** The clinician's first line. */
export const openingLine = (): string => PRACTICE.script.opener;

/** The plan lines of this focus that no answer has covered yet, in plan order. */
export function uncovered(plan: VisitPlan, focus: Focus, covered: readonly string[]): PlanItem[] {
  return itemsForFocus(plan, focus).filter((i) => !covered.includes(i.id));
}

/** The reply after the person's n-th answer: it covers the n-th line, then asks about the next one. */
export function scriptedReply(plan: VisitPlan, focus: Focus, answers: number): PracticeReply {
  const items = itemsForFocus(plan, focus);
  const done = Math.min(answers, items.length);
  const last = answers >= items.length;
  return {
    clinicianSay: last ? PRACTICE.script.closing : PRACTICE.script[items[done].kind],
    coveredItemIds: items.slice(0, done).map((i) => i.id),
    isLastTurn: last,
  };
}

export async function requestTurn(input: {
  plan: VisitPlan;
  focus: Focus;
  turns: Turn[];
  companionName: string;
}): Promise<ApiResult<PracticeReply>> {
  const { plan, focus, turns, companionName } = input;
  const res = await callApi("/api/practice", { plan, turns, focus, companionName }, PracticeReply);
  if (!res.ok) return res;
  return { ok: true, data: scriptedReply(plan, focus, turns.filter((t) => t.role === "me").length) };
}

/** Level 1 a hint, level 2 the sentence with its last word left blank, level 3 the whole sentence. */
export function helpAnswer(item: PlanItem, level: HelpLevelShown): HelpAnswer {
  if (level === 1) return { level, text: PRACTICE.helpHints[item.kind], prefix: "", suffix: "" };
  if (level === 3) return { level, text: item.text, prefix: "", suffix: "" };
  const words = item.text.trim().split(/\s+/);
  const tail = words.pop() ?? "";
  const suffix = /[.?!,;:]+$/.exec(tail)?.[0] ?? "";
  return { level, text: item.text, prefix: words.join(" "), suffix };
}

/** The sentence the person built from level 2: the text before the blank, what they typed, the ending mark. */
export const composeBlank = (a: HelpAnswer, typed: string): string =>
  `${a.prefix} ${typed.trim()}${a.suffix}`.trim();

export async function requestHelp(input: {
  plan: VisitPlan;
  item: PlanItem;
  level: HelpLevelShown;
  clinicianQuestion: string;
}): Promise<ApiResult<HelpAnswer>> {
  const { plan, item, level, clinicianQuestion } = input;
  const body = { level, clinicianQuestion, mainConcern: plan.mainConcern, symptomsInMyWords: plan.symptomsInMyWords };
  const res = await callApi("/api/sayit", body, SayItReply);
  return res.ok ? { ok: true, data: helpAnswer(item, level) } : res;
}
