/**
 * Literal-mode check: short sentences, no idioms, one command at a time. Always soft (07 section 1.1):
 * it ranks attempts and informs the UI, it never blocks a reply on its own.
 * Matching is by whole word on normalised text, so 'a bit' never fires inside 'a bite' or 'a bitter pill'.
 */
import type { GuardCode } from "@/features/shared/guards";
import { normalizeText, splitSentences } from "@/lib/text/tokens";

export type LintReason = "too_long" | "idiom" | "double_command";
export interface LintFailure {
  sentence: string;
  reason: LintReason;
}
export const MAX_WORDS = 15;

/** Words as a reader counts them: letters (with an inner apostrophe), or a number such as 2.5 or 1,000. Hyphens and full stops separate words. */
const WORD_RE = /\p{N}+(?:[.,]\p{N}+)*|[\p{L}\p{M}]+(?:['’][\p{L}]+)*/gu;
export const countWords = (sentence: string): number => (normalizeText(sentence).match(WORD_RE) ?? []).length;

/** Lowercase, no invisible characters, hyphens and punctuation become single spaces. */
const flatten = (s: string): string =>
  normalizeText(s)
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

/** Regex sources over flattened text. Verb idioms list their inflections: figured out, ran through, hanging in there. */
export const IDIOM_PATTERNS: readonly string[] = [
  "(?:run|runs|ran|running) through",
  "a bit",
  "little bit",
  // "what kind of pain" is a question about a type, not a hedge: only "kind of"/"sort of" NOT after a word like what/this/any/a.
  "(?<!\\b(?:what|which|this|that|these|those|any|some|another|same|every|each|other|different|the|a|an|one)\\s)(?:sort|kind) of",
  "kinda",
  "sorta",
  "(?:touch|touched|touches|touching) base",
  "(?:keep|keeps|kept|keeping) an eye",
  "piece of cake",
  "under the weather",
  "heads up",
  "(?:hang|hangs|hung|hanging) in there",
  "(?:figure|figures|figured|figuring) (?:it |this |that |things |something )?out",
  "in a nutshell",
  "on the same page",
  "on your plate",
  "bear with me",
  "hit the ground running",
  "(?:bite|bites|bit|biting) the bullet",
  "(?:break|breaks|broke|breaking) the ice",
  "call it a day",
  "call it a night",
  "(?:cut|cuts|cutting) corners",
  "(?:keep|keeps|kept|keeping) in mind",
  "at the end of the day",
  "(?:give|gives|gave|giving) it a shot",
  "(?:get|gets|got|getting) the ball rolling",
  "back to square one",
  "back to the drawing board",
  "think outside the box",
  "rule of thumb",
  "play it by ear",
  "(?:take|takes|took|taking) it easy",
  "no big deal",
  "pretty much",
  "a couple of",
  "all ears",
  "long shot",
  "(?:in|on) the same boat",
  "on the fence",
  "(?:pull|pulls|pulled|pulling) (?:my|your|his|her|their) leg",
  "(?:spill|spills|spilled|spilling) the beans",
  "once in a blue moon",
  "(?:feel|feels|feeling|felt) blue",
  "over the moon",
  "on cloud nine",
  "(?:in|out of) the loop",
  "out of the blue",
  "blessing in disguise",
  "an arm and a leg",
  "raining cats and dogs",
  "let the cat out of the bag",
  "(?:beat|beats|beating) around the bush",
  "(?:jump|jumps|jumped|jumping) the gun",
  "(?:go|goes|went|going) the extra mile",
  "(?:get|gets|got|getting) cold feet",
  "tip of the iceberg",
  "(?:take|takes|took|taking) a rain check",
  "(?:ring|rings|rang|ringing) a bell",
  "(?:read|reads|reading) between the lines",
  "(?:see|sees|saw|seeing) eye to eye",
  "(?:get|gets|got|getting) a handle on",
  "(?:hold|holds|held|holding) your horses",
  "pain in the neck",
  "(?:give|gives|gave|giving) (?:me|you|us) a ring",
  "(?:keep|keeps|kept|keeping) (?:my|your|our) fingers crossed",
  "(?:go|goes|went|going) with the flow",
  "(?:get|gets|got|getting) to the bottom of",
  "(?:sleep|slept|sleeping) on it",
  "(?:keep|keeps|kept|keeping) it together",
  "(?:fill|fills|filled|filling) (?:me|you|us) in",
  "bitter pill to swallow",
  "a dime a dozen",
  "down to earth",
  "at the drop of a hat",
  "ball is in your court",
];

const IDIOMS: readonly RegExp[] = IDIOM_PATTERNS.map((p) => new RegExp(`(?<![\\p{L}\\p{N}'])(?:${p})(?![\\p{L}\\p{N}'])`, "u"));

const COMMANDS = [
  "open", "close", "take", "put", "write", "tell", "ask", "bring", "call", "go", "sit", "stand", "wait", "read", "say",
  "pick", "choose", "tap", "press", "drink", "eat", "lie", "keep", "come", "give", "show", "follow", "check", "sign",
  "fill", "turn", "move", "walk", "book", "send", "make", "stop", "start", "try", "look", "find", "use", "pay", "rest", "see",
].join("|");
const COMMAND_SET = new Set(COMMANDS.split("|"));
const LEAD = /^(?:please |then |now |first |next |also )+/;

/**
 * Two or more commands in one sentence, joined by "and", "then", a comma or a semicolon: "Open the door, sit down."
 * The sentence must start with a command, so "Write down when it starts and how strong it is." (one command) passes.
 */
function isDoubleCommand(sentence: string): boolean {
  const clauses = normalizeText(sentence)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}',;]+/gu, " ")
    .split(/\s*[,;]\s*|\s+(?:and then|and|then)\s+/)
    .map((c) => c.trim().replace(LEAD, ""))
    .filter(Boolean);
  const starts = clauses.map((c) => COMMAND_SET.has(c.split(" ")[0]));
  return starts[0] === true && starts.filter(Boolean).length >= 2;
}

export function literalLint(text: string, opts: { maxWords?: number } = {}): { ok: boolean; failures: LintFailure[] } {
  const maxWords = opts.maxWords ?? MAX_WORDS;
  const failures: LintFailure[] = [];
  // A line break inside a sentence is not a sentence end; only punctuation ends one.
  for (const sentence of splitSentences(text.replace(/\s+/g, " "))) {
    const flat = flatten(sentence);
    if (countWords(sentence) > maxWords) failures.push({ sentence, reason: "too_long" });
    if (IDIOMS.some((re) => re.test(flat))) failures.push({ sentence, reason: "idiom" });
    if (isDoubleCommand(sentence)) failures.push({ sentence, reason: "double_command" });
  }
  return { ok: failures.length === 0, failures };
}

const CODE: Record<LintReason, GuardCode> = {
  too_long: "lint_too_long",
  idiom: "lint_idiom",
  double_command: "lint_double_command",
};

/** Soft guard codes for any number of output strings. Codes only, never the text. */
export function lintCodes(texts: readonly string[]): GuardCode[] {
  const seen = new Set<LintReason>();
  for (const t of texts) for (const f of literalLint(t).failures) seen.add(f.reason);
  return (Object.keys(CODE) as LintReason[]).filter((r) => seen.has(r)).map((r) => CODE[r]);
}
