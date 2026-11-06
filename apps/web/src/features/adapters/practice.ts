// The practice calls: the real /api/practice and /api/sayit through callApi. The scripted helpers below are the offline
// answer for "Help me say it", used only when the AI cannot be reached.
import { PRACTICE } from "@/content/practice";
import { itemsForFocus } from "@/features/practice/labels";
import { PracticeReply, SayItReply } from "@/features/shared/schemas";
import type { ApiResult, Focus, PlanItem, Turn, VisitPlan } from "@/features/shared/types";
import { callApi } from "@/lib/api/callApi";

export type PracticeReply = typeof PracticeReply._output;

export type HelpLevelShown = 1 | 2 | 3;
/** What the Help me say it sheet shows at one level. Level 2 has the text before a blank, the blank, and what follows it. */
export type HelpAnswer = { level: HelpLevelShown; text: string; prefix: string; suffix: string };

/** The clinician's first line. */
export const openingLine = (): string => PRACTICE.script.opener;

/** The plan lines of this focus that no answer has covered yet, in plan order. */
export function uncovered(plan: VisitPlan, focus: Focus, covered: readonly string[]): PlanItem[] {
  return itemsForFocus(plan, focus).filter((i) => !covered.includes(i.id));
}

export async function requestTurn(input: {
  plan: VisitPlan;
  focus: Focus;
  turns: Turn[];
  companionName: string;
}): Promise<ApiResult<PracticeReply>> {
  const { plan, focus, turns, companionName } = input;
  // Only what the person said is checked for a crisis here. The first turn has none, and the server still checks.
  const typed = turns.filter((t) => t.role === "me").map((t) => t.text);
  return callApi("/api/practice", { plan, turns, focus, companionName }, PracticeReply, typed.length ? { typedText: typed } : { skipCrisisCheck: true });
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

/** The help text the model wrote, shaped for the sheet: level 2 is split at its first [blank]. */
export function helpFromScript(level: HelpLevelShown, script: string): HelpAnswer {
  if (level !== 2) return { level, text: script, prefix: "", suffix: "" };
  const m = /\[[^\]]*\]/.exec(script);
  if (!m) return { level, text: script, prefix: script, suffix: "" };
  return { level, text: script, prefix: script.slice(0, m.index).trim(), suffix: script.slice(m.index + m[0].length) };
}

export async function requestHelp(input: {
  plan: VisitPlan;
  item: PlanItem;
  level: HelpLevelShown;
  clinicianQuestion: string;
  companionName: string;
}): Promise<ApiResult<HelpAnswer>> {
  const { plan, item, level, clinicianQuestion, companionName } = input;
  const body = { level, clinicianQuestion, mainConcern: plan.mainConcern, symptomsInMyWords: plan.symptomsInMyWords, companionName };
  const res = await callApi("/api/sayit", body, SayItReply, { skipCrisisCheck: true });
  if (res.ok) return { ok: true, data: helpFromScript(level, res.data.script) };
  // The AI could not answer: say it with the person's own words instead.
  return "crisis" in res ? res : { ok: true, data: helpAnswer(item, level) };
}
