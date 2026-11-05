/**
 * Remember: an evidence-checked recap of the sample visit. The model cites lines by label (L1..Ln) and plan items by
 * label (q1..qn); `finalize` maps both back to real ids and runs verifyEvidence. A claim the lines do not back is
 * demoted to a fixed "I could not confirm this" line, never retried (07 D11). The advice guard is off because a recap
 * quotes doses that the clinician said in the visit.
 */
import { recapFallback } from "@/features/recap/fallback";
import { recapMock } from "@/features/recap/mock";
import type { PlanItemRef } from "@/features/recap/planStatusFallback";
import { NOTHING_CONFIRMED, recapEmptyCodes, verifyEvidence } from "@/features/recap/verifyEvidence";
import { composePrompt } from "@/features/shared/composePrompt";
import { RecapModelOut, RecapReply, RecapRequest, type RecapModelOutT, type RecapReplyT, type RecapRequestT } from "@/features/shared/schemas";
import type { TaskSpec } from "@/features/shared/task";
import { buildLedger } from "@/lib/ai/ledger";
import { lintCodes } from "@/lib/literalLint";
import { RUMI_PERSONA } from "../../../prompts/persona";
import { RECAP_VERSION, recapTask } from "../../../prompts/recap";

/** Enabled plan items in the order the prompt labels them q1..qn. */
const planRefs = (r: RecapRequestT): PlanItemRef[] => (r.plan?.items ?? []).filter((i) => i.enabled).map((i) => ({ id: i.id, text: i.text }));
const lineLabels = (r: RecapRequestT): Map<string, string> => new Map(r.lines.map((l, n) => [`L${n + 1}`, l.id]));
const planLabels = (r: RecapRequestT): Map<string, string> => new Map(planRefs(r).map((p, n) => [`q${n + 1}`, p.id]));

export const recapSpec: TaskSpec<RecapRequestT, RecapModelOutT, RecapReplyT> = {
  name: "recap",
  promptVersion: RECAP_VERSION,
  tier: "quality",
  request: RecapRequest,
  modelOut: RecapModelOut,
  reply: RecapReply,
  // The recap input is a fixed sample visit, never text the user typed in this request.
  crisisFields: () => ({}),
  buildLedger: (r) => buildLedger({ planItems: planRefs(r), lines: r.lines }),
  build: (ctx) =>
    composePrompt(ctx, {
      persona: RUMI_PERSONA,
      task: recapTask(ctx.r.mySpeaker),
      // Speaker letters are enum values checked by the request schema.
      data: [`SPEAKERS: ${ctx.r.lines.map((l, n) => `L${n + 1}=${l.speaker}`).join(", ")}`],
    }),
  validate: (r, o) => {
    const lines = lineLabels(r);
    const plan = planLabels(r);
    const known = (labels: readonly string[]): boolean => labels.every((l) => lines.has(l));
    const unknown = o.items.some((i) => !known(i.evidence)) || o.planStatus.some((p) => !plan.has(p.itemId) || !known(p.evidence));
    return [...(unknown ? (["unknown_label"] as const) : []), ...lintCodes(o.items.map((i) => i.text))];
  },
  finalize: (r, o) => {
    const lines = lineLabels(r);
    const plan = planLabels(r);
    const ids = (labels: readonly string[]): string[] => labels.flatMap((l) => lines.get(l) ?? []);
    const labelled: RecapModelOutT = {
      items: o.items.map((i) => ({ ...i, evidence: ids(i.evidence) })),
      planStatus: o.planStatus.flatMap((p) => {
        const itemId = plan.get(p.itemId);
        return itemId === undefined ? [] : [{ ...p, itemId, evidence: ids(p.evidence) }];
      }),
    };
    const v = verifyEvidence(r.lines, labelled, r.mySpeaker, planRefs(r));
    // A recap with nothing at all would say nothing: show the one fixed line instead (the empty escape hatch, 07 D14).
    return { items: v.items, unconfirmed: recapEmptyCodes(v).length > 0 ? [NOTHING_CONFIRMED] : v.unconfirmed, planStatus: v.planStatus, dropped: v.dropped };
  },
  fallback: recapFallback,
  adviceGuard: false,
  useMemory: false,
  temperature: 0.1,
  maxOutputTokens: 2000,
  mock: recapMock,
};
