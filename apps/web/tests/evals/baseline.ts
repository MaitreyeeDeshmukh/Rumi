/**
 * The baseline arm (D34): the same model per task tier, temperature, token cap, reasoning effort, JSON schema and the
 * same one-sentence task description as the harness, but ONE attempt and none of the harness machinery (no persona,
 * no rules, no fence, no guards, no retries, no fallback). The harness arm may make up to three calls; that is disclosed.
 *
 * PINNED is the single source for both arms. Phase 2/3 must call `assertHarnessParity` with the real TaskSpecs so a
 * later edit to a spec cannot silently make the comparison unfair.
 */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { PlanModelOut, PracticeModelOut, RecapModelOut, SayItModelOut } from '../../src/features/shared/schemas';
import type { Tier } from '../../src/features/shared/task';
import type { Arm, TaskName } from './types';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface TaskPin {
  tier: Tier;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  taskSentence: string;
}

/** Tiers from 06 section 0; temperatures from plan 01; caps from 07 D23 (P3 may raise caps after the reasoning-token spike, in this one place). */
export const PINNED: Record<TaskName, TaskPin> = {
  plan: { tier: 'quality', temperature: 0.2, maxOutputTokens: 1200, reasoningEffort: 'low', taskSentence: "Turn the user's own words into a short visit plan for their doctor appointment." },
  practice: { tier: 'fast', temperature: 0.6, maxOutputTokens: 900, reasoningEffort: 'low', taskSentence: 'Act as a doctor in a practice visit and reply with one short turn for the user to answer.' },
  sayit: { tier: 'fast', temperature: 0.3, maxOutputTokens: 900, reasoningEffort: 'low', taskSentence: 'Write a short sentence the user can say to their doctor.' },
  recap: { tier: 'quality', temperature: 0.1, maxOutputTokens: 2000, reasoningEffort: 'low', taskSentence: 'List what was said in this visit transcript and the line ids that show it.' },
};

export const ARMS: Record<Arm, { arm: Arm; maxCalls: number }> = {
  baseline: { arm: 'baseline', maxCalls: 1 },
  harness: { arm: 'harness', maxCalls: 3 },
};

const MODEL_OUT = { plan: PlanModelOut, practice: PracticeModelOut, sayit: SayItModelOut, recap: RecapModelOut } as const;

export interface BaselineCall extends TaskPin {
  system: string;
  user: string;
  jsonSchema: object;
  maxCalls: 1;
}

/** What the provider should be asked for one baseline case. The request body is passed through as plain JSON. */
export function baselineCall(task: TaskName, requestBody: unknown): BaselineCall {
  const pin = PINNED[task];
  return { ...pin, system: pin.taskSentence, user: JSON.stringify(requestBody), jsonSchema: z.toJSONSchema(MODEL_OUT[task]), maxCalls: 1 };
}

/** What the harness arm must report for each task so the two arms can be compared (E-12). The schema is the model-output JSON schema. */
export interface ParitySpec {
  tier: string;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: string;
  taskSentence: string;
  jsonSchema: unknown;
}

/** Throws if any harness spec is missing or drifts from the pin on ANY of the six pinned parameters. */
export function assertHarnessParity(specs: Partial<Record<TaskName, ParitySpec>> | undefined): void {
  if (!specs || typeof specs !== 'object') throw new Error('harness and baseline arms cannot be compared: no harness specs were provided');
  const problems: string[] = [];
  for (const task of Object.keys(PINNED) as TaskName[]) {
    const spec = specs[task];
    if (!spec) {
      problems.push(`${task}: no harness spec provided`);
      continue;
    }
    for (const key of ['tier', 'temperature', 'maxOutputTokens', 'reasoningEffort', 'taskSentence'] as const) {
      if (spec[key] !== PINNED[task][key]) problems.push(`${task}.${key}: harness ${String(spec[key])} vs pinned ${String(PINNED[task][key])}`);
    }
    if (!isDeepStrictEqual(spec.jsonSchema, z.toJSONSchema(MODEL_OUT[task]))) problems.push(`${task}.jsonSchema: harness schema differs from the model-output schema the baseline uses`);
  }
  if (problems.length > 0) throw new Error(`harness and baseline arms differ: ${problems.join('; ')}`);
}
