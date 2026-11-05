/**
 * Say it: three help levels (hint, blanks, safe sentence). The script may use only facts the user gave; a missing
 * fact is a [blank]. Level 1 is a question, never a statement about the user (07 D13). Blanks are derived from the
 * script by code, never taken from the model. `claims_human` is not checked here: the user may say their own job.
 */
import { level1Codes } from "@/features/sayit/level1";
import { inventedClaimCodes } from "@/features/shared/claims";
import { sayitFallback } from "@/features/sayit/fallback";
import { sayitMock } from "@/features/sayit/mock";
import type { GuardCode } from "@/features/shared/guards";
import { SayItModelOut, SayItReply, SayItRequest, type SayItModelOutT, type SayItReplyT, type SayItRequestT } from "@/features/shared/schemas";
import type { TaskSpec } from "@/features/shared/task";
import { buildLedger } from "@/lib/ai/ledger";
import { lintCodes } from "@/lib/literalLint";
import { extractBlanks, validateGrounding } from "@/lib/text/specifics";
import { SAYIT_VERSION, SCENARIO_CONTEXT, sayitTask } from "../../../prompts/sayit";
import { RUMI_PERSONA } from "../../../prompts/persona";

export const sayitSpec: TaskSpec<SayItRequestT, SayItModelOutT, SayItReplyT> = {
  name: "sayit",
  promptVersion: SAYIT_VERSION,
  tier: "fast",
  request: SayItRequest,
  modelOut: SayItModelOut,
  reply: SayItReply,
  // Only the question the user typed. The saved concern and symptoms were checked when they were typed.
  crisisFields: (r): Record<string, string> => (r.clinicianQuestion === undefined ? {} : { clinicianQuestion: r.clinicianQuestion }),
  // The clinician's question is not evidence about the user, so it is not in the ledger: a number in it must not become "said by the user".
  buildLedger: (r) => buildLedger({ mainConcern: r.mainConcern, symptoms: r.symptomsInMyWords }),
  build: (ctx) => {
    const { scenario, clinicianQuestion } = ctx.r;
    // The scenario is an enum word looked up in a fixed table; only the clinician's question is user text, and it is fenced.
    const context =
      scenario !== undefined && Object.hasOwn(SCENARIO_CONTEXT, scenario)
        ? `CONTEXT: ${SCENARIO_CONTEXT[scenario]}`
        : `CONTEXT: The clinician asked: ${ctx.fence("clinicianQuestion", clinicianQuestion ?? "")}`;
    return { system: RUMI_PERSONA, user: `${context}\n${sayitTask(ctx.r.level)}` };
  },
  validate: (r, o, ledger) => {
    // Nothing about the user's body, health, habits, history or safety unless the user's own words say it. A level 1 hint
    // may also repeat the topic of the clinician's question, because it only asks what the user wants to add.
    const allowed = [...ledger.items.map((i) => i.text), ...(r.level === 1 && r.clinicianQuestion !== undefined ? [r.clinicianQuestion] : [])];
    const codes: GuardCode[] = [
      ...validateGrounding(o.script, ledger),
      ...inventedClaimCodes(o.script, allowed, r.level === 1 || r.clinicianQuestion === undefined ? [] : [r.clinicianQuestion]),
      // Nothing but blanks ("[what] [how]") says nothing at all.
      ...(o.script.normalize("NFKC").replace(/\[[^\]]*\]/g, " ").match(/\p{L}/u) === null ? (["empty"] as const) : []),
      ...(r.level === 1 ? level1Codes(o.script, ledger) : []),
      ...lintCodes([o.script]),
    ];
    return codes.filter((c, n) => codes.indexOf(c) === n);
  },
  finalize: (_r, o) => ({ script: o.script.trim(), blanks: extractBlanks(o.script.trim()) }),
  fallback: sayitFallback,
  adviceGuard: true,
  useMemory: true,
  temperature: 0.3,
  maxOutputTokens: 900,
  mock: sayitMock,
};
