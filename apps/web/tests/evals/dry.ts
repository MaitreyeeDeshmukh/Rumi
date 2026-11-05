/**
 * Dry adapter: replays recorded replies from tests/evals/fixtures/replies/*.json so the scorers, runner and report can be
 * exercised in CI with no key. It measures NOTHING about the product; every report line says so. Replies are chosen by a
 * stable hash of the case id (about 10% retry_ok, 8% fallback, rest model_ok), the crisis suite replays a crisis card for
 * positives, and `fault` swaps in the error, mock, empty or seeded-bad fixtures so the INVALID and FAIL paths can be seen.
 */
import { z } from 'zod';
import byCaseJson from './fixtures/replies/by_case.json';
import crisisJson from './fixtures/replies/crisis.json';
import emptyJson from './fixtures/replies/empty.json';
import errorJson from './fixtures/replies/error.json';
import fallbackJson from './fixtures/replies/fallback.json';
import mockJson from './fixtures/replies/mock.json';
import modelOkJson from './fixtures/replies/model_ok.json';
import retryOkJson from './fixtures/replies/retry_ok.json';
import seededBadJson from './fixtures/replies/seeded_bad.json';
import type { DryFault } from './flags';
import { isObj } from './scorers/body';
import type { RunFn } from './runner';
import type { Arm, CaseClass, EvalCase, Observation, TaskName } from './types';

const ObservationRecord = z.object({
  status: z.number().int(),
  degraded: z.boolean(),
  attempts: z.number().int().min(0),
  modelUsed: z.string().nullable(),
  mode: z.literal('mock').optional(),
  tier: z.enum(['quality', 'fast']).nullable().optional(),
  latencyMs: z.number().optional(),
  promptVersion: z.string().optional(),
  canaryInPrompt: z.boolean().optional(),
  calls: z.array(z.object({ model: z.string(), tokensIn: z.number(), tokensOut: z.number() })).optional(),
  body: z.unknown(),
});
const PerTask = z.object({ plan: ObservationRecord, practice: ObservationRecord, sayit: ObservationRecord, recap: ObservationRecord });

export type FixtureSet = Record<CaseClass, Record<TaskName, z.infer<typeof ObservationRecord>>>;

export function loadFixtures(): { byClass: FixtureSet; seededBad: Record<string, z.infer<typeof ObservationRecord>>; byCase: Record<string, unknown> } {
  return {
    byCase: z.record(z.string(), z.unknown()).parse(byCaseJson),
    byClass: {
      model_ok: PerTask.parse(modelOkJson),
      retry_ok: PerTask.parse(retryOkJson),
      fallback: PerTask.parse(fallbackJson),
      crisis: PerTask.parse(crisisJson),
      mock: PerTask.parse(mockJson),
      error: PerTask.parse(errorJson),
      empty: PerTask.parse(emptyJson),
    },
    seededBad: z.record(z.string(), ObservationRecord).parse(seededBadJson),
  };
}

/** FNV-1a: stable across runs and platforms, so a dry run is reproducible. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The baseline makes one attempt and has no fallback; red-team rows are never replayed as fallbacks (a row with no model answer would be INVALID). */
export function dryClassFor(c: EvalCase, fault?: DryFault, arm: Arm = 'harness'): CaseClass {
  if (c.suite === 'crisis') return c.crisisSet === 'negative' || c.crisisSet === 'knownHard' ? 'model_ok' : 'crisis';
  if (fault && fault !== 'seeded' && hash(c.id) % 7 === 0) return fault;
  if (arm === 'baseline') return 'model_ok';
  const h = hash(c.id) % 100;
  if (c.suite === 'redteam') return h < 10 ? 'retry_ok' : 'model_ok';
  return h < 10 ? 'retry_ok' : h < 18 ? 'fallback' : 'model_ok';
}

export function makeDryRun(fault?: DryFault, arm: Arm = 'harness'): RunFn {
  const { byClass, seededBad, byCase } = loadFixtures();
  return async (c) => {
    const seeded = fault === 'seeded' ? seededBad[c.id] : undefined;
    const cls = dryClassFor(c, fault, arm);
    const recorded = byCase[c.id];
    // A recorded reply per case id (pick by how many user turns have been sent for the scripted probe) stands in for the model.
    const meTurns = isObj(c.body) && Array.isArray(c.body.turns) ? c.body.turns.filter((t) => isObj(t) && t.role === 'me').length : 0;
    const body = Array.isArray(recorded) ? recorded[Math.max(0, Math.min(recorded.length - 1, meTurns - 1))] : recorded;
    const useRecorded = body !== undefined && (cls === 'model_ok' || cls === 'retry_ok' || cls === 'fallback');
    const base = byClass[cls][c.task];
    const rec = seeded ?? (useRecorded ? { ...base, body } : base);
    const { mode, ...rest } = rec;
    const obs: Observation = { ...rest, tier: rest.tier ?? null, mode: mode ?? 'dry' };
    return structuredClone(obs);
  };
}
