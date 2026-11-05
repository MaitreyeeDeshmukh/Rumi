/**
 * Practice: Dr. Lee asks, the user answers. The clinician never asserts (no finding, no digit, no "looks normal"),
 * never claims to be real, and may only name plan items by their labels q1..qn. Which items the user covered is
 * proposed by the model and confirmed by code against the user's latest turn (07 D12).
 */
import { confirmCovered } from "@/features/practice/confirmCovered";
import { practiceFallback } from "@/features/practice/fallback";
import { enabledItems, idsForLabels, unknownLabelCodes } from "@/features/practice/labels";
import { practiceMock } from "@/features/practice/mock";
import { composePrompt } from "@/features/shared/composePrompt";
import type { GuardCode } from "@/features/shared/guards";
import {
  PracticeModelOut,
  PracticeReply,
  PracticeRequest,
  type PracticeModelOutT,
  type PracticeReplyT,
  type PracticeRequestT,
} from "@/features/shared/schemas";
import type { TaskSpec } from "@/features/shared/task";
import { claimsHumanCodes, clinicianFindingCodes } from "@/lib/ai/guards/output";
import { buildLedger } from "@/lib/ai/ledger";
import { lintCodes } from "@/lib/literalLint";
import { CLOSING_LINE, DR_LEE_PERSONA } from "../../../prompts/persona";
import { MAX_CLINICIAN_TURNS, PRACTICE_VERSION, practiceTask } from "../../../prompts/practice";

const latestMe = (r: PracticeRequestT): string | undefined => r.turns.findLast((t) => t.role === "me")?.text;
const clinicianTurns = (r: PracticeRequestT): number => r.turns.filter((t) => t.role === "clinician").length;

export const practiceSpec: TaskSpec<PracticeRequestT, PracticeModelOutT, PracticeReplyT> = {
  name: "practice",
  promptVersion: PRACTICE_VERSION,
  tier: "fast",
  request: PracticeRequest,
  modelOut: PracticeModelOut,
  reply: PracticeReply,
  // Only the latest thing the user typed. Old turns, clinician turns and plan items never run the crisis check (07 D2).
  crisisFields: (r): Record<string, string> => {
    const text = latestMe(r);
    return text === undefined ? {} : { latestMe: text };
  },
  buildLedger: (r) => buildLedger({ mainConcern: r.plan.mainConcern, symptoms: r.plan.symptomsInMyWords, planItems: enabledItems(r.plan) }),
  build: (ctx) =>
    composePrompt(ctx, {
      persona: DR_LEE_PERSONA,
      task: practiceTask(ctx.r.focus),
      // Role words come from an enum; the text of every turn is fenced, so a typed "clinician:" is only text.
      data: ctx.r.turns.map((t, n) => `T${n + 1} ${t.role}: ${ctx.fence(`T${n + 1}`, t.text)}`),
    }),
  validate: (r, o, ledger) => {
    const codes: GuardCode[] = [
      ...unknownLabelCodes(r.plan, o.coveredItemIds),
      ...clinicianFindingCodes(o.clinicianSay, ledger),
      ...claimsHumanCodes(o.clinicianSay),
      ...(/[\p{L}\p{N}]/u.test(o.clinicianSay) ? [] : (["empty"] as const)),
      ...lintCodes([o.clinicianSay]),
      ...((o.clinicianSay.match(/\?/g) ?? []).length > 1 ? (["multi_question"] as const) : []),
    ];
    return codes.filter((c, n) => codes.indexOf(c) === n);
  },
  finalize: (r, o) => {
    // After the last allowed question Dr. Lee closes, whatever the model wrote.
    const closing = o.isLastTurn || clinicianTurns(r) >= MAX_CLINICIAN_TURNS;
    const me = latestMe(r);
    return {
      clinicianSay: clinicianTurns(r) >= MAX_CLINICIAN_TURNS ? CLOSING_LINE : o.clinicianSay.trim(),
      coveredItemIds: me === undefined ? [] : confirmCovered(idsForLabels(r.plan, o.coveredItemIds), r.plan, [me]),
      isLastTurn: closing,
    };
  },
  fallback: practiceFallback,
  adviceGuard: true,
  useMemory: true,
  temperature: 0.6,
  maxOutputTokens: 900,
  mock: practiceMock,
};
