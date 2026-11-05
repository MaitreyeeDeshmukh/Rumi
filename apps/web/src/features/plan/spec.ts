/**
 * Get ready: the user's own words become a visit plan. Pure wiring of what already exists (06 section 6).
 * Hard checks: the main concern comes from the user's words, at least one item is the user's, suggested items are
 * generic, nothing invented (numbers, names, medicines, blanks). Lint is soft.
 */
import { planFallback, planIdFor } from "@/features/plan/fallback";
import { planMock } from "@/features/plan/mock";
import { keepSupportedSymptoms, mainConcernCodes, planItemCodes } from "@/features/plan/keepSupportedSymptoms";
import type { GuardCode } from "@/features/shared/guards";
import { PlanModelOut, PlanReply, PlanRequest, type PlanModelOutT, type PlanReplyT, type PlanRequestT } from "@/features/shared/schemas";
import type { TaskSpec } from "@/features/shared/task";
import { buildLedger } from "@/lib/ai/ledger";
import { lintCodes } from "@/lib/literalLint";
import { validateGrounding } from "@/lib/text/specifics";
import { contentWords } from "@/lib/text/tokens";
import { RUMI_PERSONA } from "../../../prompts/persona";
import { PLAN_TASK, PLAN_VERSION } from "../../../prompts/plan";

const now = (): string => new Date().toISOString();

export const planSpec: TaskSpec<PlanRequestT, PlanModelOutT, PlanReplyT> = {
  name: "plan",
  promptVersion: PLAN_VERSION,
  tier: "quality",
  request: PlanRequest,
  modelOut: PlanModelOut,
  reply: PlanReply,
  // Only what the user typed in this request.
  crisisFields: (r) => ({ rawText: r.rawText }),
  buildLedger: (r) => buildLedger({ rawText: r.rawText }),
  // The harness adds the rules, STYLE and FACTS (the user's sentences) around this; the plan task needs no other data.
  build: () => ({ system: RUMI_PERSONA, user: PLAN_TASK }),
  validate: (r, o, ledger) => {
    const texts = [o.mainConcern, ...o.symptomsInMyWords, ...o.items.map((i) => i.text)];
    const codes: GuardCode[] = [
      ...mainConcernCodes(r.rawText, o.mainConcern),
      ...planItemCodes(o.items),
      ...validateGrounding(texts, ledger),
      ...(o.items.some((i) => i.text.trim() === "") ? (["empty"] as const) : []),
      ...lintCodes([o.mainConcern, ...o.items.map((i) => i.text)]),
    ];
    return codes.filter((c, n) => codes.indexOf(c) === n);
  },
  finalize: (r, o, ledger) => {
    // No content word in the user's text (ok, hi, digits, emoji): nothing to copy, so the plan is the fixed prompt (07 D10).
    if (contentWords(r.rawText).length === 0) {
      const fixed = planFallback(r, now());
      delete fixed.degraded; // the fixed prompt is the intended answer here, not a failure
      return fixed;
    }
    return {
      plan: {
        id: planIdFor(r.rawText),
        title: "Visit plan",
        createdAt: now(),
        mainConcern: o.mainConcern.trim(),
        symptomsInMyWords: keepSupportedSymptoms(r.rawText, o.symptomsInMyWords),
        // Suggested items start switched off: the user chooses them (as in the demo plan).
        items: o.items.map((it, n) => ({ id: `q${n + 1}`, text: it.text.trim(), kind: it.kind, source: it.source, enabled: it.source === "user" })),
      },
      thin: ledger.thin,
    };
  },
  fallback: (r) => planFallback(r, now()),
  adviceGuard: true,
  useMemory: true,
  temperature: 0.2,
  maxOutputTokens: 1200,
  mock: planMock,
};
