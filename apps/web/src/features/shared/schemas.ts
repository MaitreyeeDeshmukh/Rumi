/**
 * Zod schemas for every request, model output and wire reply. Frozen in Phase 0.
 * Rules: ids are allowlisted and unique, free text has hard length caps, the helper's name is an allowlist,
 * every reply may carry `degraded`, and persona facts on the wire carry no free text.
 */
import { z } from 'zod';
import {
  COMPANION_RE,
  FACTS_BATCH_MAX,
  FACT_KEY_RE,
  FACT_KINDS,
  FOCUS_VALUES,
  HELP_LEVELS,
  ID_RE,
  LIMITS,
  PACING_KEYS,
  PLAN_ITEM_KINDS,
  SAY_SCENARIOS,
  SPEAKERS,
  STATED_FACT_KINDS,
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

// ---- get ready chat (one turn of the conversation before the plan)
export const GetReadyChatRequest = z.object({
  /** Everything the person has said so far, one message per line. */
  rawText: z.string().trim().min(1).max(LIMITS.rawTextMax),
  /** The questions Rumi already asked, so it never repeats one. */
  asked: z.array(z.string().max(200)).max(8),
  skipped: z.number().int().min(0).max(8),
  companionName: Companion,
});
export const GetReadyChatModelOut = z.object({
  reply: z.string().max(300),
  question: z.string().max(200),
  ready: z.boolean(),
  crisis: z.boolean(),
});
export const GetReadyChatReply = z.object({ reply: z.string().max(300), question: z.string().max(200), ready: z.boolean(), ...reply });

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

// ---- appointment scan: the details of the person's own letter, email or photo
/** Longest pasted or extracted text the scan reads. A letter is a page; more than this is not one appointment. */
export const SCAN_TEXT_MAX = 4000;
/** YYYY-MM-DD or empty. Checked again against the calendar and the source text in features/appointmentScan/ground.ts. */
const ScanDate = z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/);
/** HH:MM on a 24-hour clock, or empty. */
const ScanTime = z.string().regex(/^(?:\d{2}:\d{2})?$/);
const scanFields = {
  provider: z.string().max(80).default(''),
  clinic: z.string().max(80).default(''),
  date: ScanDate.default(''),
  time: ScanTime.default(''),
  address: z.string().max(200).default(''),
  department: z.string().max(80).default(''),
  reason: z.string().max(200).default(''),
  instructions: z.array(z.string().max(200)).max(8).default([]),
  bring: z.array(z.string().max(120)).max(12).default([]),
};
export const ScanFields = z.object(scanFields);
export const AppointmentScanRequest = z.object({
  text: z.string().trim().min(1).max(SCAN_TEXT_MAX),
  companionName: Companion,
});
export const AppointmentScanModelOut = ScanFields;
export const AppointmentScanReply = z.object({ fields: ScanFields, ...reply });
/** A photo: the same fields plus the words read from it (kept as the document excerpt). */
export const AppointmentPhotoModelOut = z.object({ transcript: z.string().max(SCAN_TEXT_MAX).default(''), ...scanFields });
export const AppointmentPhotoReply = z.object({ fields: ScanFields, text: z.string().max(SCAN_TEXT_MAX), ...reply });

// ---- hospital lookup: items come from the model, links from server code
export const LookupRequest = z.object({
  /** Who or where, as the person confirmed it. */
  place: z.string().trim().min(2).max(160),
  care: z.enum(['primary', 'specialist', 'dentist', 'mental', 'other']),
});
export const LookupModelOut = z.object({
  found: z.boolean(),
  items: z.array(z.object({ text: z.string().min(1).max(200) })).max(12),
});
export const LookupReply = z.object({
  found: z.boolean(),
  items: z.array(z.object({ text: z.string().min(1).max(160), url: z.string().max(500).regex(/^https:\/\//).optional() })).max(8),
  /** Pages the search read, added by server code. */
  sources: z.array(z.string().max(500).regex(/^https:\/\//)).max(5),
});

// ---- memory wire format: facts carry no free text; the server derives the sentence from fixed tables
const FactKey = z.string().regex(FACT_KEY_RE);
/** Is (kind, key, level) one of the facts Rumi can make? Shared by every fact schema below. */
const knownFact = (f: { kind: string; key: string; level?: number }): boolean => {
  if (f.kind === 'support_pref') return (SUPPORT_PRESET_IDS as readonly string[]).includes(f.key) && f.level === undefined;
  if (f.kind === 'pacing') return (PACING_KEYS as readonly string[]).includes(f.key) && f.level === undefined;
  return (PLAN_ITEM_KINDS as readonly string[]).includes(f.key) && (HELP_LEVELS as readonly number[]).includes(f.level as number);
};
const UNKNOWN_FACT = { message: 'unknown fact key or level for kind' };
const IsoTime = z.iso.datetime();

export const PersonaFactWire = z
  .strictObject({
    kind: z.enum(FACT_KINDS),
    key: FactKey,
    level: HelpLevelSchema.optional(),
  })
  .refine(knownFact, UNKNOWN_FACT);
/** A fact on its way to or from the database: the wire fact plus the time the person last changed it. */
export const PersonaFactSync = z
  .strictObject({
    kind: z.enum(FACT_KINDS),
    key: FactKey,
    level: HelpLevelSchema.optional(),
    client_updated_at: IsoTime,
  })
  .refine(knownFact, UNKNOWN_FACT);
/** "This stated fact was turned off at this time." Only stated kinds can be removed one by one. */
export const PersonaFactRemoval = z
  .strictObject({ kind: z.enum(STATED_FACT_KINDS), key: FactKey, client_updated_at: IsoTime })
  .refine(knownFact, UNKNOWN_FACT);
export const FactsRequest = z.strictObject({
  facts: z
    .array(PersonaFactSync)
    .max(FACTS_BATCH_MAX)
    .refine((facts) => unique(facts.map((f) => `${f.kind}:${f.key}`)), { message: 'duplicate fact' }),
  removed: z
    .array(PersonaFactRemoval)
    .max(FACTS_BATCH_MAX)
    .refine((removed) => unique(removed.map((f) => `${f.kind}:${f.key}`)), { message: 'duplicate removal' })
    .optional(),
});
/** Body of /api/memory/forget: how long ago the browser last synced (its own clock), so the server can lengthen its settle wait. */
export const ForgetRequest = z.strictObject({ sinceSyncMs: z.number().finite().min(0).max(600_000).optional() });
export const ForgetReply = z.object({ status: z.enum(['ok', 'failed']) });
/** `facts` is what the database holds after the write, so a second device can merge it. `rejected` counts stored rows we ignored. */
export const FactsReply = z.object({
  saved: z.number().int().min(0),
  rejected: z.number().int().min(0),
  facts: z.array(PersonaFactSync).max(FACTS_BATCH_MAX),
});

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
export type ScanFieldsT = z.infer<typeof ScanFields>;
export type AppointmentScanRequestT = z.infer<typeof AppointmentScanRequest>;
export type AppointmentScanModelOutT = z.infer<typeof AppointmentScanModelOut>;
export type AppointmentScanReplyT = z.infer<typeof AppointmentScanReply>;
export type AppointmentPhotoModelOutT = z.infer<typeof AppointmentPhotoModelOut>;
export type AppointmentPhotoReplyT = z.infer<typeof AppointmentPhotoReply>;
export type LookupRequestT = z.infer<typeof LookupRequest>;
export type LookupModelOutT = z.infer<typeof LookupModelOut>;
export type LookupReplyT = z.infer<typeof LookupReply>;
export type PersonaFactWireT = z.infer<typeof PersonaFactWire>;
export type PersonaFactSyncT = z.infer<typeof PersonaFactSync>;
export type PersonaFactRemovalT = z.infer<typeof PersonaFactRemoval>;
export type GetReadyChatRequestT = z.infer<typeof GetReadyChatRequest>;
export type GetReadyChatModelOutT = z.infer<typeof GetReadyChatModelOut>;
export type GetReadyChatReplyT = z.infer<typeof GetReadyChatReply>;
