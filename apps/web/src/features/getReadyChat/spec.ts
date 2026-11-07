/**
 * Get ready chat: one turn of the conversation before the plan. The model hears what the person has said so far and
 * answers with a soft acknowledgement and the ONE question that will help the plan most (or says it is ready). Nothing
 * here is a fixed script: the question depends on the person's words. When the model is down, a plain rule-based
 * helper (features/getReady/followUps.ts) asks instead, so the person is never stuck.
 */
import { GET_READY } from "@/content/getReady";
import { nextFollowUps } from "@/features/getReady/followUps";
import { inventedClaimCodes } from "@/features/shared/claims";
import type { GuardCode } from "@/features/shared/guards";
import {
  GetReadyChatModelOut,
  GetReadyChatReply,
  GetReadyChatRequest,
  type GetReadyChatModelOutT,
  type GetReadyChatReplyT,
  type GetReadyChatRequestT,
} from "@/features/shared/schemas";
import type { TaskSpec } from "@/features/shared/task";
import { buildLedger } from "@/lib/ai/ledger";
import { lintCodes } from "@/lib/literalLint";
import { validateGrounding } from "@/lib/text/specifics";
import { RUMI_PERSONA } from "../../../prompts/persona";
import { GET_READY_CHAT_TASK, GET_READY_CHAT_VERSION } from "../../../prompts/getReadyChat";

/** Rumi asks at most this many questions, then makes the plan. */
export const MAX_CHAT_QUESTIONS = 3;
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The rule-based turn: used when the model is down and for MOCK_AI. */
export function chatByRules(r: GetReadyChatRequestT): GetReadyChatReplyT {
  const next = nextFollowUps(r.rawText).find((f) => !r.asked.some((q) => same(q, f.question)));
  if (!next || r.asked.length >= MAX_CHAT_QUESTIONS || r.skipped >= 2) return { reply: GET_READY.makingPlan, question: "", ready: true };
  return { reply: GET_READY.thanks, question: next.question, ready: false };
}

export const getReadyChatSpec: TaskSpec<GetReadyChatRequestT, GetReadyChatModelOutT, GetReadyChatReplyT> = {
  // Shares the plan task's name so telemetry and quotas stay in one place; the prompt version tells them apart.
  name: "plan",
  promptVersion: GET_READY_CHAT_VERSION,
  tier: "fast",
  request: GetReadyChatRequest,
  modelOut: GetReadyChatModelOut,
  reply: GetReadyChatReply,
  crisisFields: (r) => ({ rawText: r.rawText }),
  buildLedger: (r) => buildLedger({ rawText: r.rawText }),
  build: (ctx) => ({
    system: RUMI_PERSONA,
    user: `${GET_READY_CHAT_TASK}\nASKED: ${ctx.r.asked.map((q, i) => ctx.fence(`Q${i + 1}`, q)).join(" ") || "none"}\nSKIPPED: ${ctx.r.skipped}`,
  }),
  validate: (r, o, ledger) => {
    const texts = [o.reply, o.question].filter((t) => t.trim() !== "");
    const said = ledger.items.map((i) => i.text);
    const codes: GuardCode[] = [
      ...validateGrounding(texts, ledger),
      ...texts.flatMap((t) => inventedClaimCodes(t, said)),
      ...lintCodes(texts),
      ...((o.question.match(/\?/g) ?? []).length > 1 ? (["multi_question"] as const) : []),
      // A turn must say something, and must not ask what was already asked.
      ...(o.reply.trim() === "" || (!o.ready && (o.question.trim() === "" || r.asked.some((q) => same(q, o.question)))) ? (["empty"] as const) : []),
    ];
    return codes.filter((c, n) => codes.indexOf(c) === n);
  },
  finalize: (r, o) => {
    const done = o.ready || r.skipped >= 2 || r.asked.length >= MAX_CHAT_QUESTIONS;
    const q = o.question.trim();
    return { reply: o.reply.trim(), question: done ? "" : q.endsWith("?") ? q : `${q}?`, ready: done };
  },
  fallback: (r) => ({ ...chatByRules(r), degraded: true }),
  adviceGuard: true,
  useMemory: false,
  temperature: 0.5,
  maxOutputTokens: 300,
  mock: chatByRules,
};
