/**
 * Zod schemas for every eval dataset file, plus the minimum counts D36 requires (enforced by tests/unit/evalData.test.ts).
 * Request shapes come from the frozen contract (`shared/schemas`), so a dataset row that the real route would reject
 * fails here first.
 */
import { z } from 'zod';
import { FOCUS_VALUES, SAY_SCENARIOS } from '../../../src/features/shared/constants';
import {
  FocusSchema,
  PlanRequest,
  PracticeRequest,
  RecapRequest,
  SayItRequest,
  SpeakerSchema,
  TurnSchema,
  VisitPlanSchema,
} from '../../../src/features/shared/schemas';
import { getPath } from '../scorers/body';
import type { Hold } from '../types';
import crisisJson from './crisis.json';
import planJson from './plan.json';
import practiceJson from './practice.json';
import recapJson from './recap.json';
import redteamJson from './redteam.json';
import sayitJson from './sayit.json';
import scenariosJson from './scenarios.json';

export const HoldSchema: z.ZodType<Hold> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('valid_reply') }),
  z.object({ type: z.literal('not_crisis') }),
  z.object({ type: z.literal('no_links') }),
  z.object({ type: z.literal('no_advice') }),
  z.object({ type: z.literal('no_invented_numbers') }),
  z.object({ type: z.literal('max_chars'), max: z.number().int().positive() }),
  z.object({ type: z.literal('refusal_intent') }),
  z.object({ type: z.literal('contains_any'), anyOf: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('no_question_marks') }),
  z.object({ type: z.literal('field_equals'), path: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ type: z.literal('min_items'), path: z.string().min(1), min: z.number().int().min(0) }),
  z.object({ type: z.literal('plan_status'), itemId: z.string().min(1), status: z.string().min(1) }),
  z.object({ type: z.literal('plan_status_not_all'), status: z.string().min(1) }),
  z.object({ type: z.literal('no_item_cites'), lineIds: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('section_count'), section: z.string().min(1), min: z.number().int().optional(), max: z.number().int().optional() }),
  z.object({ type: z.literal('every_item_cites_input_line') }),
  z.object({
    type: z.literal('no_text_matches'),
    pattern: z.string().min(1).refine(
      (p) => {
        try {
          new RegExp(p, 'i');
          return true;
        } catch {
          return false;
        }
      },
      { message: 'pattern is not a valid regular expression' },
    ),
  }),
  z.object({ type: z.literal('english_only') }),
  z.object({ type: z.literal('max_items'), path: z.string().min(1), max: z.number().int().min(0) }),
  z.object({ type: z.literal('drug_not_recommended'), drug: z.string().min(2) }),
  z.object({ type: z.literal('items_supported_by_cited_lines') }),
  z.object({ type: z.literal('canary_was_in_prompt') }),
  z.object({ type: z.literal('human_check'), note: z.string().min(1) }),
]);

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const noDupes = (ids: string[]): boolean => new Set(ids).size === ids.length;
const holds = z.array(HoldSchema);

export const PlanDataSchema = z
  .array(z.object({ id: Id, rawText: PlanRequest.shape.rawText, tags: z.array(z.string()).optional() }))
  .refine((rows) => noDupes(rows.map((r) => r.id)), { message: 'duplicate plan id' });

const ProbeStepSchema = z.object({ me: z.string().min(1).max(600), holds });
export const PracticeDataSchema = z.object({
  cases: z.array(z.object({ id: Id, focus: FocusSchema, plan: VisitPlanSchema, turns: z.array(TurnSchema).max(20), holds })),
  probes: z.array(
    z.object({
      id: Id,
      focus: FocusSchema,
      plan: VisitPlanSchema,
      opener: z.string().min(1).max(600),
      steps: z.array(ProbeStepSchema).min(4),
      distinctReplies: z.number().int().min(1),
    }),
  ),
});

export const SayItDataSchema = z
  .array(
    z
      .object({
        id: Id,
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        scenario: z.enum(SAY_SCENARIOS).optional(),
        clinicianQuestion: z.string().min(1).max(300).optional(),
        mainConcern: z.string().max(300).optional(),
        symptomsInMyWords: z.array(z.string().max(100)).max(12).optional(),
      })
      .refine((r) => (r.scenario ? 1 : 0) + (r.clinicianQuestion ? 1 : 0) === 1, { message: 'exactly one of scenario or clinicianQuestion' }),
  )
  .refine((rows) => noDupes(rows.map((r) => r.id)), { message: 'duplicate sayit id' });

export const RECAP_KINDS = ['no_medicine', 'two_medicines', 'negation', 'speaker_d', 'long_60', 'adversarial_lines', 'wrong_dose', 'wrong_frequency'] as const;
export const RecapDataSchema = z
  .array(
    z.object({
      id: Id,
      kind: z.enum(RECAP_KINDS),
      mySpeaker: SpeakerSchema,
      plan: VisitPlanSchema.optional(),
      lines: RecapRequest.shape.lines,
      holds: holds.min(1),
    }),
  )
  .refine((rows) => noDupes(rows.map((r) => r.id)), { message: 'duplicate recap id' });

const listOfText = z.array(z.string().min(3).max(300));
export const CrisisDataSchema = z.object({
  positive: listOfText,
  heldOutPositive: listOfText,
  negative: listOfText,
  knownFalsePositives: listOfText,
  fieldPositive: z.object({ practice: listOfText, sayit: listOfText }),
  messyPositive: z.array(z.string().min(3).max(300)),
  knownHard: listOfText,
  practiceClinicianNegative: z.array(z.object({ clinician: z.string().min(3).max(300), me: z.string().min(3).max(300) })),
});

const TASKS = ['plan', 'practice', 'sayit', 'recap'] as const;
const TaskEnum = z.enum(TASKS);
const REQUEST_BY_TASK = { plan: PlanRequest, practice: PracticeRequest, sayit: SayItRequest, recap: RecapRequest } as const;

const RedteamRow = z.object({
  id: Id,
  task: TaskEnum,
  field: z.string().min(1),
  payload: z.string().min(1).max(1500),
  forbidden: z.array(z.string().min(1)).min(1),
  mustHold: holds.min(1),
  memory: z.array(z.string().min(1).max(200)).optional(),
  /** Which arms the row is meaningful for. Default both; the canary and memory rows are harness-only. */
  arms: z.array(z.enum(['harness', 'baseline'])).min(1).optional(),
  /** Cross-user marker: must also be in `forbidden`. */
  marker: z.string().min(6).optional(),
  note: z.string().min(1),
});
export const RedteamDataSchema = z
  .object({ bases: z.object({ plan: PlanRequest, practice: PracticeRequest, sayit: SayItRequest, recap: RecapRequest }), rows: z.array(RedteamRow) })
  .superRefine((d, ctx) => {
    d.rows.forEach((row, i) => {
      if (getPath(d.bases[row.task], row.field) === undefined) {
        ctx.addIssue({ code: 'custom', path: ['rows', i, 'field'], message: `field ${row.field} not found in ${row.task} base` });
      }
      if (row.marker && !row.forbidden.includes(row.marker)) {
        ctx.addIssue({ code: 'custom', path: ['rows', i, 'marker'], message: 'the cross-user marker must be listed in forbidden' });
      }
      if (row.mustHold.some((h) => h.type === 'canary_was_in_prompt') && row.arms?.join() !== 'harness') {
        ctx.addIssue({ code: 'custom', path: ['rows', i, 'arms'], message: 'a canary row is only meaningful for the harness arm' });
      }
      if (row.mustHold.every((h) => h.type === 'human_check')) {
        ctx.addIssue({ code: 'custom', path: ['rows', i, 'mustHold'], message: 'needs at least one hold that code can score' });
      }
    });
    if (!noDupes(d.rows.map((r) => r.id))) ctx.addIssue({ code: 'custom', message: 'duplicate redteam id' });
  });

export const ScenariosDataSchema = z
  .array(
    z.object({
      id: Id,
      task: TaskEnum,
      input: z.unknown(),
      mustHold: holds.min(1),
      forbidden: z.array(z.string().min(1)).min(1),
    }),
  )
  .superRefine((rows, ctx) => {
    rows.forEach((row, i) => {
      const parsed = REQUEST_BY_TASK[row.task].safeParse(row.input);
      if (!parsed.success) ctx.addIssue({ code: 'custom', path: [i, 'input'], message: `input is not a valid ${row.task} request` });
    });
    if (!noDupes(rows.map((r) => r.id))) ctx.addIssue({ code: 'custom', message: 'duplicate scenario id' });
  });

/** D36 minimums. tests/unit/evalData.test.ts fails if any dataset drops below these. */
export const MIN_COUNTS = {
  plan: 10,
  practiceFocus: FOCUS_VALUES.length,
  practiceProbes: 1,
  sayit: 18,
  recap: 8,
  crisisPositive: 15,
  crisisHeldOut: 15,
  crisisNegative: 25,
  crisisFieldEach: 5,
  crisisMessy: 8,
  crisisKnownHard: 2,
  practiceClinicianNegative: 3,
  redteam: 20,
  scenarios: 12,
} as const;

export interface EvalData {
  plan: z.infer<typeof PlanDataSchema>;
  practice: z.infer<typeof PracticeDataSchema>;
  sayit: z.infer<typeof SayItDataSchema>;
  recap: z.infer<typeof RecapDataSchema>;
  crisis: z.infer<typeof CrisisDataSchema>;
  redteam: z.infer<typeof RedteamDataSchema>;
  scenarios: z.infer<typeof ScenariosDataSchema>;
}

/** Parses every dataset file; throws with the failing file name so a bad edit is obvious. */
export function loadAll(): EvalData {
  const parse = <T>(name: string, schema: z.ZodType<T>, raw: unknown): T => {
    const r = schema.safeParse(raw);
    if (!r.success) throw new Error(`dataset ${name}.json is invalid: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    return r.data;
  };
  return {
    plan: parse('plan', PlanDataSchema, planJson),
    practice: parse('practice', PracticeDataSchema, practiceJson),
    sayit: parse('sayit', SayItDataSchema, sayitJson),
    recap: parse('recap', RecapDataSchema, recapJson),
    crisis: parse('crisis', CrisisDataSchema, crisisJson),
    redteam: parse('redteam', RedteamDataSchema, redteamJson),
    scenarios: parse('scenarios', ScenariosDataSchema, scenariosJson),
  };
}
