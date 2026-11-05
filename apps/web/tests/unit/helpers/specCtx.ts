/** Test helpers for the four TaskSpecs: build a prompt the way the harness will, and run validate like it does. */
import { isHard, type GuardCode } from "@/features/shared/guards";
import type { BuildContext, TaskSpec } from "@/features/shared/task";
import { fence } from "@/lib/ai/prompt";

export const NONCE = "abcdef123456";

export function ctxFor<Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, r: Req, memory: string[] = [], companionName = "Rumi"): BuildContext<Req> {
  return { r, ledger: spec.buildLedger(r), fence: (label, text) => fence(NONCE, label, text), memory, companionName };
}

export const promptFor = <Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, r: Req, memory: string[] = []) => spec.build(ctxFor(spec, r, memory));

export function check<Req, Out, Reply>(spec: TaskSpec<Req, Out, Reply>, r: Req, out: Out): { hard: GuardCode[]; soft: GuardCode[] } {
  const codes = spec.validate(r, out, spec.buildLedger(r));
  return { hard: codes.filter(isHard), soft: codes.filter((c) => !isHard(c)) };
}

/** The text with every fenced data span removed: what is left is only our own words. */
export const outsideFences = (prompt: string): string => prompt.replace(/<<<DATA [A-Za-z0-9]+ field=[a-z0-9_]+>>>[\s\S]*?<<<END [A-Za-z0-9]+>>>/gi, "");
