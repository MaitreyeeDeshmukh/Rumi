/**
 * Practice without a model (07 D17): Dr. Lee follows a short script chosen by focus. The questions come from the
 * prototype's general-visit scenario, rewritten to one short question each. The clinician only asks.
 * Stateless: the position in the script comes from how many of the user's turns moved the conversation on.
 */
import { confirmCovered } from "@/features/practice/confirmCovered";
import { enabledItems } from "@/features/practice/labels";
import type { PracticeReplyT, PracticeRequestT } from "@/features/shared/schemas";
import type { Focus } from "@/features/shared/types";
import { ADVICE_REFUSAL, CLOSING_LINE, NOTES_LINE, STOP_LINE, WAIT_LINE } from "../../../prompts/persona";
import { MAX_CLINICIAN_TURNS } from "../../../prompts/practice";

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

const norm = (s: string): string => s.replace(/[’‘]/g, "'").toLowerCase();

/**
 * A request to stop (rules, tested in both directions):
 * - CONTINUE wins: "don't stop", "keep going", "carry on", "continue", "let's continue" mean the person wants more.
 * - "stop" as a whole word is a request, EXCEPT when it is about the person's own life or something else: "should/can/do I
 *   stop ...", "I can't stop coughing", "stop taking/eating/doing ..." (any -ing word other than asking/talking/questioning),
 *   "bus stop", "non-stop", "my doctor said stop", "a stop sign". "stopwatch" is a different word.
 * - "enough" counts only as "that's enough", "enough questions", "enough now", "I've had enough"; "I have enough pills" and
 *   "not enough sleep" do not.
 * - quit, finish, end: "I want to quit", "I want to end this", "I'd like to finish now" (the turn ends there); "quit smoking" does not.
 * - "I'm done", "that's all" (as the turn), "too many questions", "no more questions", "I need a break" (not "a break from work").
 * - "tired" is a request only as "I'm/I am/we're (so) tired" in a short turn (6 words or fewer) that gives no symptom or
 *   time context ("all the time", "after class", "today", "of these headaches"). "I feel tired", "tired of these headaches" are content.
 */
const REQUEST_ING = new Set(["asking", "talking", "questioning", "quizzing"]);
const TIRED_CONTEXT =
  /\b(headaches?|pain|hurts?|aches?|dizz\w*|sleep\w*|cough\w*|nause\w*|all the time|all day|every|lately|since|after|when|during|because|in the (morning|afternoon|evening)|at night|of (these|my|the)|weeks?|months?|days?|today|tonight|yesterday)\b/;
const CONTINUE = /\b(don't|do not|dont)\s+stop\b|\b(keep going|carry on|continue|go on|go ahead)\b/;
const STOP_PHRASES =
  /\b(that'?s|that is|it'?s|this is) enough\b|\benough (questions|now|for today|please)\b|\bi'?ve had enough\b|\bi have had enough\b|\btoo many questions\b|\bno more questions\b|\b(need|take|have|want) a (break|pause)\b(?! from)|\bend the practice\b|^\s*(i'm|i am) done\b|^\s*that'?s all\b|\b(i want to|i'd like to|i would like to|let's|can we|we can|i'm going to|i need to) (quit|finish|end|wrap up)( this| it| now| here| the practice| the session| for today)*\s*[.!?]*\s*$/;
const NOT_A_REQUEST_NEXT = new Set(["sign", "signs", "light", "lights", "button", "motion", "watch"]);
function isStopRequest(text: string): boolean {
  const t = norm(text);
  if (CONTINUE.test(t)) return false;
  if (STOP_PHRASES.test(t)) return true;
  for (const m of t.matchAll(/\bstop\b/g)) {
    const before = t.slice(0, m.index);
    const next = t.slice((m.index ?? 0) + 4).match(/^\s*([a-z']+)/)?.[1];
    const aboutOwnLife =
      /\b(should|can|could|do|did|will|would)\s+i\s+$/.test(before) ||
      /\b(can't|cannot|couldn't|won't|unable to|not able to)\s+(seem to\s+)?$/.test(before) ||
      /\b(bus|train|tram)\s+$/.test(before) ||
      /non-?$/.test(before) ||
      /\b(said|says|told me|told us|tells me)\s+(to\s+)?$/.test(before) ||
      (next !== undefined && (NOT_A_REQUEST_NEXT.has(next) || (next.endsWith("ing") && !REQUEST_ING.has(next))));
    if (!aboutOwnLife) return true;
  }
  return /\b(i'm|i am|im|we're|we are)\s+(so |too |really |very |just )?tired\b/.test(t) && t.split(/\s+/).length <= 6 && !TIRED_CONTEXT.test(t);
}
const ADVICE =
  /\b(what|which) (medicine|medication|meds|pills?|drugs?|treatment)\b|\bshould i (take|use|try|stop|start)\b|\b(should|can|could|may|do|must) i (stop|start|skip|increase|reduce|take|use|try)( (my|the|this|that|these|those|taking|using))? (medicine|medication|meds|pills?|drugs?|tablets?|dose|treatment|insulin|ibuprofen)\b|\bwhat should i do(?! next)\b|\bdo i have\b|\bwhat do i have\b|\bwhat('s| is) wrong with me\b|\bdiagnos|\b(dose|dosage)\b|\bprescri|\bis (it|this|my [a-z ]{1,25}) (cancer|serious|dangerous|ok|okay|normal|fine|high|low|bad)\b|\bcan i take\b|\bhow (much|many) [a-z ]{0,30}\b(take|dose)\b/;
const NOT_SURE = /\b(i'?m not sure|i am not sure|not sure|i don'?t know|i do not know|i dunno|dunno|idk|no idea)\b/;
const NOTES = /\b(notes?|read(ing)? (from|it))\b/;

type Kind = "stop" | "advice" | "unsure" | "notes" | "answer";
const kindOf = (text: string): Kind => {
  const t = norm(text);
  if (isStopRequest(text)) return "stop";
  if (ADVICE.test(t)) return "advice";
  if (NOT_SURE.test(t)) return "unsure";
  return NOTES.test(t) && t.split(/\s+/).length <= 10 ? "notes" : "answer";
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
  // The persona line about notes is said once, not on every turn that mentions them.
  const notesSaid = r.turns.at(-2)?.text.startsWith(NOTES_LINE) === true;
  const say = kind === "advice" ? `${ADVICE_REFUSAL} ${line}` : kind === "notes" && !notesSaid ? `${NOTES_LINE} ${line}` : line;
  return reply(say, at === script.length - 1, covered);
}
