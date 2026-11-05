/**
 * The one place a task prompt is laid out (06 section 4, 07 D22). Every spec calls it from `build`.
 *   system: the fixed preamble (rules) plus the persona text for the task.
 *   user:   STYLE (stated preferences), FACTS (the evidence ledger, each line fenced), the task's own data lines,
 *           then TASK. TASK comes last so the instructions are the freshest text.
 * User-origin text reaches the prompt only through `ctx.fence`, which uses this request's nonce.
 */
import type { BuildContext } from "@/features/shared/task";
import { buildPreamble, renderFactsRegion, renderStyleRegion, renderTaskRegion } from "@/lib/ai/prompt";

const FENCE_HEAD = /^<<<DATA ([A-Za-z0-9]{8,32}) field=/;

/**
 * BuildContext carries `fence` but not the nonce itself, and the region headers need it. A fence of empty text
 * starts with the nonce, so it is read from there. It throws if the fence format ever changes, never guesses.
 */
export function nonceOf(fence: BuildContext<unknown>["fence"]): string {
  const m = FENCE_HEAD.exec(fence("n", ""));
  if (!m) throw new Error("fence format changed: no nonce found");
  return m[1];
}

export interface PromptParts {
  /** Persona text appended to the preamble (Rumi voice, or Dr. Lee for practice). */
  persona: string;
  /** The task text from prompts/*. */
  task: string;
  /** Extra data lines (conversation, speakers, context). User text in them must already be fenced. */
  data?: readonly string[];
}

export function composePrompt<Req>(ctx: BuildContext<Req>, parts: PromptParts): { system: string; user: string } {
  const nonce = nonceOf(ctx.fence);
  return {
    system: `${buildPreamble(ctx.companionName)}\n${parts.persona}`,
    user: [
      renderStyleRegion(ctx.memory, nonce),
      renderFactsRegion(ctx.ledger, nonce, ctx.fence),
      ...(parts.data ?? []),
      renderTaskRegion(parts.task, nonce),
    ].join("\n"),
  };
}
