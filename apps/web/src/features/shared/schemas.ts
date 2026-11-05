import { z } from 'zod';

const Id = z.string().min(1).max(40);
const Companion = z.string().min(1).max(30);
export const FocusSchema = z.enum(['problem', 'questions', 'needs', 'next_steps', 'whole']);
export const PlanItemSchema = z.object({
  id: Id, text: z.string().min(1).max(200), kind: z.enum(['concern', 'question', 'accommodation']),
  source: z.enum(['user', 'suggested']), enabled: z.boolean(),
});
export const VisitPlanSchema = z.object({
  id: Id, title: z.string().max(80), createdAt: z.string().max(40), mainConcern: z.string().max(300),
  symptomsInMyWords: z.array(z.string().max(100)).max(12), items: z.array(PlanItemSchema).max(12),
});
export const TurnSchema = z.object({ role: z.enum(['clinician', 'me']), text: z.string().max(600), usedHelp: z.boolean().optional() });
export const TranscriptLineSchema = z.object({ id: Id, speaker: z.enum(['A', 'B', 'C', 'D']), text: z.string().min(1).max(400) });

// ---- plan
export const PlanRequest = z.object({ rawText: z.string().min(1).max(2000), companionName: Companion });
export const PlanModelOut = z.object({
  mainConcern: z.string().max(300),
  symptomsInMyWords: z.array(z.string().max(100)).max(12),
  items: z.array(z.object({
    text: z.string().min(1).max(200), kind: z.enum(['concern', 'question', 'accommodation']), source: z.enum(['user', 'suggested']),
  })).min(1).max(8),
  crisis: z.boolean(),
});
export const PlanReply = z.object({ plan: VisitPlanSchema });

// ---- practice
export const PracticeRequest = z.object({
  plan: VisitPlanSchema, turns: z.array(TurnSchema).max(20), focus: FocusSchema, companionName: Companion,
});
export const PracticeModelOut = z.object({
  clinicianSay: z.string().min(1).max(300), coveredItemIds: z.array(Id).max(12), isLastTurn: z.boolean(), crisis: z.boolean(),
});
export const PracticeReply = z.object({ clinicianSay: z.string(), coveredItemIds: z.array(Id), isLastTurn: z.boolean() });

// ---- say it (also used for "Help me say it" inside practice)
export const SAY_SCENARIOS = ['book', 'late', 'repeat', 'written', 'next'] as const;
export const SayItRequest = z.object({
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  clinicianQuestion: z.string().min(1).max(300).optional(),
  scenario: z.enum(SAY_SCENARIOS).optional(),
  mainConcern: z.string().max(300).optional(),
  symptomsInMyWords: z.array(z.string().max(100)).max(12).optional(),
  companionName: Companion,
}).refine((r) => (r.clinicianQuestion ? 1 : 0) + (r.scenario ? 1 : 0) === 1, { message: 'exactly one of clinicianQuestion or scenario' });
export const SayItModelOut = z.object({ script: z.string().min(1).max(400), blanks: z.array(z.string().max(60)).max(6), crisis: z.boolean() });
export const SayItReply = z.object({ script: z.string(), blanks: z.array(z.string()) });

// ---- recap (sample visit only in the MVP)
const RecapItemOut = z.object({ section: z.enum(['discussed', 'instructions', 'medications', 'next_steps']), text: z.string().min(1).max(300), evidence: z.array(Id).max(6) });
const PlanStatusOut = z.object({ itemId: Id, status: z.enum(['asked_by_me', 'asked_by_other', 'not_asked', 'unclear']), evidence: z.array(Id).max(6) });
export const RecapRequest = z.object({
  lines: z.array(TranscriptLineSchema).min(1).max(60), mySpeaker: z.enum(['A', 'B', 'C', 'D']), plan: VisitPlanSchema.optional(),
});
export const RecapModelOut = z.object({ items: z.array(RecapItemOut).max(20), unconfirmed: z.array(z.string().max(300)).max(10), planStatus: z.array(PlanStatusOut).max(12) });
export const RecapReply = RecapModelOut.extend({ dropped: z.number().int().min(0) });
