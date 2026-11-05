/**
 * Zod schemas for every request, model output and wire reply. Frozen in Phase 0.
 * Rules: ids are allowlisted and unique, free text has hard length caps, the helper's name is an allowlist,
 * every reply may carry `degraded`, and persona facts on the wire carry no free text.
 */
import { z } from 'zod';
import {
  COMPANION_RE,
  FACT_KEY_RE,
  FOCUS_VALUES,
  HELP_LEVELS,
  ID_RE,
  LIMITS,
  PACING_KEYS,
  PLAN_ITEM_KINDS,
  SAY_SCENARIOS,
  SPEAKERS,
  SUPPORT_PRESET_IDS,
} from './constants';

const Id = z.string().regex(ID_RE);
const Companion = z.string().regex(COMPANION_RE);
const unique = (ids: string[]): boolean => new Set(ids).size === ids.length;

export const FocusSchema = z.enum(FOCUS_VALUES);
export const SpeakerSchema = z.enum(SPEAKERS);
export const PlanItemKindSchema = z.enum(PLAN_ITEM_KINDS);
export const HelpLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const PlanItemSchema = z.object({
  id: Id,
  text: z.string().min(1).max(LIMITS.itemTextMax),
  kind: PlanItemKindSchema,
  source: z.enum(['user', 'suggested']),
  enabled: z.boolean(),
});

export const VisitPlanSchema = z.object({
  id: Id,
  title: z.string().max(80),
  createdAt: z.string().max(40),
  mainConcern: z.string().max(LIMITS.concernMax),
  symptomsInMyWords: z.array(z.string().max(100)).max(12),
  items: z
    .array(PlanItemSchema)
    .max(LIMITS.planItemsMax)
    .refine((items) => unique(items.map((i) => i.id)), { message: 'duplicate plan item id' }),
});

export const TurnSchema = z.object({
  role: z.enum(['clinician', 'me']),
  text: z.string().max(LIMITS.turnTextMax),
  usedHelp: z.boolean().optional(),
});

export const TranscriptLineSchema = z.object({
  id: Id,
  speaker: SpeakerSchema,
  text: z.string().min(1).max(LIMITS.lineTextMax),
});

/** Model replies that set the crisis flag may omit everything else; the harness reads the flag before Zod. */
const reply = { degraded: z.boolean().optional() } as const;

// ---- plan
export const PlanRequest = z.object({
  rawText: z.string().trim().min(1).max(LIMITS.rawTextMax),
  companionName: Companion,
});
export const PlanModelOut = z.object({
  mainConcern: z.string().max(LIMITS.concernMax),
  symptomsInMyWords: z.array(z.string().max(100)).max(12),
  items: z
    .array(
      z.object({
        text: z.string().min(1).max(LIMITS.itemTextMax),
        kind: PlanItemKindSchema,
        source: z.enum(['user', 'suggested']),
      }),
    )
    .min(1)
    .max(8),
  crisis: z.boolean(),
});
export const PlanReply = z.object({ plan: VisitPlanSchema, thin: z.boolean().optional(), ...reply });

// ---- practice
export const PracticeRequest = z.object({
  plan: VisitPlanSchema,
  turns: z.array(TurnSchema).max(LIMITS.turnsMax),
  focus: FocusSchema,
  companionName: Companion,
});
export const PracticeModelOut = z.object({
  clinicianSay: z.string().min(1).max(300),
  coveredItemIds: z.array(Id).max(LIMITS.planItemsMax),
  isLastTurn: z.boolean(),
  crisis: z.boolean(),
});
export const PracticeReply = z.object({
  clinicianSay: z.string(),
  coveredItemIds: z.array(Id),
  isLastTurn: z.boolean(),
  ...reply,
});

// ---- say it (also "Help me say it" inside practice)
export const SayItRequest = z
  .object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    clinicianQuestion: z.string().trim().min(1).max(300).optional(),
    scenario: z.enum(SAY_SCENARIOS).optional(),
    mainConcern: z.string().max(LIMITS.concernMax).optional(),
    symptomsInMyWords: z.array(z.string().max(100)).max(12).optional(),
    companionName: Companion,
  })
  .refine((r) => (r.clinicianQuestion ? 1 : 0) + (r.scenario ? 1 : 0) === 1, {
    message: 'exactly one of clinicianQuestion or scenario',
  });
export const SayItModelOut = z.object({
  script: z.string().min(1).max(400),
  blanks: z.array(z.string().max(60)).max(6),
  crisis: z.boolean(),
});
export const SayItReply = z.object({ script: z.string(), blanks: z.array(z.string()), ...reply });

// ---- recap (sample visit only in the MVP)
const RecapItemOut = z.object({
  section: z.enum(['discussed', 'instructions', 'medications', 'next_steps']),
  text: z.string().min(1).max(300),
  evidence: z.array(Id).max(6),
});
const PlanStatusOut = z.object({
  itemId: Id,
  status: z.enum(['asked_by_me', 'asked_by_other', 'not_asked', 'unclear']),
  evidence: z.array(Id).max(6),
});
export const RecapRequest = z.object({
  lines: z
    .array(TranscriptLineSchema)
    .min(1)
    .max(LIMITS.linesMax)
    .refine((lines) => unique(lines.map((l) => l.id)), { message: 'duplicate line id' }),
  mySpeaker: SpeakerSchema,
  plan: VisitPlanSchema.optional(),
});
/** No `unconfirmed` and no `crisis` here: the model writes no free-text notes, and the recap input is a fixed sample. */
export const RecapModelOut = z.object({
  items: z.array(RecapItemOut).max(20),
  planStatus: z.array(PlanStatusOut).max(LIMITS.planItemsMax),
});
export const RecapReply = z.object({
  items: z.array(RecapItemOut).max(20),
  unconfirmed: z.array(z.string().max(400)).max(30),
  planStatus: z.array(PlanStatusOut).max(LIMITS.planItemsMax),
  dropped: z.number().int().min(0),
  ...reply,
});

// ---- memory wire format: facts carry no free text; the server derives the sentence from fixed tables
const FactKey = z.string().regex(FACT_KEY_RE);
export const PersonaFactWire = z
  .strictObject({
    kind: z.enum(['support_pref', 'pacing', 'help_level']),
    key: FactKey,
    level: HelpLevelSchema.optional(),
  })
  .refine(
    (f) => {
      if (f.kind === 'support_pref') return (SUPPORT_PRESET_IDS as readonly string[]).includes(f.key) && f.level === undefined;
      if (f.kind === 'pacing') return (PACING_KEYS as readonly string[]).includes(f.key) && f.level === undefined;
      return (PLAN_ITEM_KINDS as readonly string[]).includes(f.key) && (HELP_LEVELS as readonly number[]).includes(f.level as number);
    },
    { message: 'unknown fact key or level for kind' },
  );
export const FactsRequest = z.strictObject({
  facts: z
    .array(PersonaFactWire)
    .max(LIMITS.factsMax)
    .refine((facts) => unique(facts.map((f) => `${f.kind}:${f.key}`)), { message: 'duplicate fact' }),
});
/** Body of /api/memory/forget: how long ago the browser last synced (its own clock), so the server can lengthen its settle wait. */
export const ForgetRequest = z.strictObject({ sinceSyncMs: z.number().finite().min(0).max(600_000).optional() });
export const ForgetReply = z.object({ status: z.enum(['ok', 'failed']) });
export const FactsReply = z.object({ saved: z.number().int().min(0), rejected: z.number().int().min(0) });

export type PlanRequestT = z.infer<typeof PlanRequest>;
export type PlanModelOutT = z.infer<typeof PlanModelOut>;
export type PlanReplyT = z.infer<typeof PlanReply>;
export type PracticeRequestT = z.infer<typeof PracticeRequest>;
export type PracticeModelOutT = z.infer<typeof PracticeModelOut>;
export type PracticeReplyT = z.infer<typeof PracticeReply>;
export type SayItRequestT = z.infer<typeof SayItRequest>;
export type SayItModelOutT = z.infer<typeof SayItModelOut>;
export type SayItReplyT = z.infer<typeof SayItReply>;
export type RecapRequestT = z.infer<typeof RecapRequest>;
export type RecapModelOutT = z.infer<typeof RecapModelOut>;
export type RecapReplyT = z.infer<typeof RecapReply>;
export type PersonaFactWireT = z.infer<typeof PersonaFactWire>;
