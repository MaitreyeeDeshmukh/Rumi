/**
 * Practice without a model (07 D17): Dr. Lee follows a short script chosen by focus. The questions come from the
 * prototype's general-visit scenario, rewritten to one short question each. The clinician only asks.
 * Stateless: the position in the script comes from how many of the user's turns moved the conversation on.
 */
import { confirmCovered } from "@/features/practice/confirmCovered";
import { enabledItems } from "@/features/practice/labels";
import type { PracticeReplyT, PracticeRequestT } from "@/features/shared/schemas";
import type { Focus } from "@/features/shared/types";
import { ADVICE_REFUSAL, CLOSING_LINE, STOP_LINE, WAIT_LINE } from "../../../prompts/persona";

export const SCRIPT: Record<Focus, readonly string[]> = {
  problem: ["Hi. What brings you in today?", "When did it start?", "How often does it happen?", "What makes it better or worse?", CLOSING_LINE],
  questions: ["Hi. Do you have any questions for me?", "Which question do you want to ask first?", "Do you have any other questions for me?", CLOSING_LINE],
  needs: ["Hi. Is there anything that would make this visit easier for you?", "Would it help if I explain each step first?", "Is there anything else you need?", CLOSING_LINE],
  next_steps: [
    "Hi. Let's practice the next steps. What do you want to know about what happens next?",
    "Can you say the next step in your own words?",
    "Would you like to ask me to write it down?",
    CLOSING_LINE,
  ],
  whole: [
    "Hi. What brings you in today?",
    "When did it start?",
    "What makes it better or worse?",
    "Is there anything that would make this visit easier for you?",
    "Do you have any questions for me?",
    CLOSING_LINE,
  ],
};

/** After this many clinician turns the practice closes, whatever the script says. */
export const MAX_CLINICIAN_TURNS = 7;

const norm = (s: string): string => s.replace(/[’‘]/g, "'");
const STOP = /^\s*(please\s+)?stop\b|\b(stop (asking|now|here|this|the practice)|(i want|i'd like|i would like|i need) to stop|let's stop|that's enough|enough( questions)?|too many questions|no more questions|(i am|i'm|im) (so |too |really )?tired (of|to))\b/i;
const ADVICE =
  /\b(what|which) (medicine|medication|meds|pills?|drugs?|treatment)\b|\bshould i (take|use|try|stop|start)\b|\bwhat should i (take|do)\b|\bdo i have\b|\bwhat do i have\b|\bwhat('s| is) wrong with me\b|\bdiagnos|\bis (it|this) (cancer|serious|dangerous)\b|\bwhat dose\b|\bhow (much|many) [a-z ]{0,30}\b(take|dose)\b|\bcan i take\b/i;
const NOT_SURE = /\b(i'?m not sure|i am not sure|not sure|i don'?t know|i do not know|no idea)\b/i;

type Kind = "stop" | "advice" | "unsure" | "answer";
const kindOf = (text: string): Kind => {
  const t = norm(text);
  return STOP.test(t) ? "stop" : ADVICE.test(t) ? "advice" : NOT_SURE.test(t) ? "unsure" : "answer";
};

export function practiceFallback(r: PracticeRequestT): PracticeReplyT {
  const me = r.turns.filter((t) => t.role === "me");
  const clinicianTurns = r.turns.length - me.length;
  const latest = me.at(-1);
  const kind = latest ? kindOf(latest.text) : undefined;
  const reply = (clinicianSay: string, isLastTurn: boolean, covered: string[] = []): PracticeReplyT => ({
    clinicianSay,
    coveredItemIds: covered,
    isLastTurn,
    degraded: true,
  });

  if (kind === "stop") return reply(STOP_LINE, true);
  if (clinicianTurns >= MAX_CLINICIAN_TURNS) return reply(CLOSING_LINE, true);
  if (kind === "unsure") return reply(WAIT_LINE, false);

  const script = SCRIPT[r.focus];
  // The opening line was already said once any clinician turn exists, so the next line is at least the second.
  const moved = me.filter((t) => kindOf(t.text) === "answer").length;
  const at = Math.min(script.length - 1, Math.max(moved, Math.min(1, clinicianTurns)));
  const line = script[at];
  const covered = latest ? confirmCovered(enabledItems(r.plan).map((i) => i.id), r.plan, [latest.text]) : [];
  return reply(kind === "advice" ? `${ADVICE_REFUSAL} ${line}` : line, at === script.length - 1, covered);
}
