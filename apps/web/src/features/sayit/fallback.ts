/**
 * Say it without a model (07 D17). Fixed, level-aware templates. They contain no fact about the user:
 * level 1 is a question plus a sentence starter, level 2 uses [blanks], level 3 is a safe sentence.
 * Seeded from sayTemplate in the prototype, with the lines that broke our rules rewritten (an invented
 * "20 minutes", a reason for being late, "really help me").
 */
import { extractBlanks } from "@/lib/text/specifics";
import type { SayItReplyT, SayItRequestT } from "@/features/shared/schemas";

type Levels = Readonly<Record<1 | 2 | 3, string>>;

/** The escape hatches of 07 D14. */
const GENERIC: Levels = {
  1: "What detail do you want to add? You can start with: I am not sure ...",
  2: "I want to tell you about [what is happening].",
  3: "I am not sure how to say this. Can you ask me one question at a time?",
};

export const SCENARIO_TEMPLATES: Readonly<Record<NonNullable<SayItRequestT["scenario"]>, Levels>> = {
  book: {
    1: "What do you want to book the visit for? You can start with: I need to book ...",
    2: "I would like to book an appointment for [what is happening].",
    3: "I would like to book an appointment. Can you tell me which times you have?",
  },
  late: {
    1: "What time do you think you will arrive? You can start with: I will arrive at ...",
    2: "I am going to be late. I will arrive at [what time].",
    3: "I am going to be late. I am not sure what time I will arrive.",
  },
  repeat: {
    1: "What part did you not understand? You can start with: Can you say ...",
    2: "I did not understand [which part]. Can you say it again?",
    3: "I did not understand. Can you say it again, more slowly?",
  },
  written: {
    1: "What do you want written down? You can start with: Can you write down ...",
    2: "Can you write down [what to do]?",
    3: "Can you write the instructions down for me?",
  },
  next: {
    1: "What do you want to know about what happens next? You can start with: What should I ...",
    2: "I want to know [what to do next].",
    3: "I want to know what to do next. Can you tell me the next step?",
  },
};

/** Answers to a clinician's question: only the shape of the answer, never the answer itself. */
const QUESTION_TEMPLATES: readonly (readonly [RegExp, Levels])[] = [
  [
    /\bhow long\b|\bwhen did\b|\bsince when\b/i,
    { 1: "How long has it been? You can start with: It started ...", 2: "It started [how long ago].", 3: GENERIC[3] },
  ],
  [
    /\bhow often\b|\bhow many times\b/i,
    { 1: "How often does it happen? You can start with: It happens ...", 2: "It happens [how often].", 3: GENERIC[3] },
  ],
  [
    /\bwhere\b.*\b(hurts?|feels?|pain|aches?|sore)\b|\bwhich part\b/i,
    { 1: "Which part of the body is it? You can start with: It is in ...", 2: "It is in [which part of my body].", 3: GENERIC[3] },
  ],
];

export function sayitFallback(r: SayItRequestT): SayItReplyT {
  const levels =
    (r.scenario ? SCENARIO_TEMPLATES[r.scenario] : QUESTION_TEMPLATES.find(([re]) => re.test(r.clinicianQuestion ?? ""))?.[1]) ?? GENERIC;
  const script = levels[r.level];
  return { script, blanks: extractBlanks(script), degraded: true };
}
