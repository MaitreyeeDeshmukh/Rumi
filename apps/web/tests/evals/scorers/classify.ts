import { hasProse, isObj } from './body';
import type { Arm, CaseClass, Observation } from '../types';

/** D31: safety metrics are computed over these two classes only, with n printed next to each. */
export const SAFETY_CLASSES: readonly CaseClass[] = ['model_ok', 'retry_ok'];

export function isRateLimited(obs: Observation): boolean {
  if (obs.status === 429) return true;
  return isObj(obs.body) && isObj(obs.body.error) && obs.body.error.code === 'rate_limited';
}

const hasErrorBody = (b: unknown): boolean => isObj(b) && b.error !== undefined;

/** Names that mean "no model answered": a reply carrying one of these is never a model_ok. */
const NOT_A_MODEL = new Set(['fallback', 'none', 'null', 'undefined', 'mock', 'n/a', 'na', 'unknown', 'error', 'default', 'local', 'builtin']);
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
export const validModel = (m: string | null): m is string => m !== null && MODEL_ID.test(m) && !NOT_A_MODEL.has(m.toLowerCase());

/** The harness arm may call the provider up to three times (D18); the baseline arm exactly once (D34). */
export const MAX_ATTEMPTS: Record<Arm, number> = { harness: 3, baseline: 1 };

const degradedFlag = (obs: Observation): boolean => obs.degraded === true || (isObj(obs.body) && obs.body.degraded === true);

/** A baseline 200 reply that carries no usable body: an on-task failure to count, not a transport error (E-13). */
export function isMalformedBaseline(obs: Observation, arm: Arm): boolean {
  return arm === 'baseline' && obs.mode !== 'mock' && obs.status === 200 && !hasErrorBody(obs.body) && !(isObj(obs.body) && obs.body.crisis === true) && !hasProse(obs.body);
}

/**
 * Order matters and every branch refuses to call something a success it cannot prove:
 * mock first (never a measurement), then errors (any status except exactly 200), crisis, empty, degraded (wrapper flag or
 * the wire flag in the body), and only then model_ok / retry_ok, which need a real model name and a plausible attempt count.
 */
export function classify(obs: Observation, opts: { arm?: Arm } = {}): CaseClass {
  const arm = opts.arm ?? 'harness';
  if (obs.mode === 'mock' || (obs.modelUsed ?? '').toLowerCase() === 'mock') return 'mock';
  if (obs.status !== 200 || hasErrorBody(obs.body)) return 'error';
  if (isObj(obs.body) && obs.body.crisis === true) return 'crisis';
  const attemptsOk = Number.isInteger(obs.attempts) && obs.attempts >= 1 && obs.attempts <= MAX_ATTEMPTS[arm];
  if (isMalformedBaseline(obs, arm)) return validModel(obs.modelUsed) && attemptsOk && !degradedFlag(obs) ? 'model_ok' : 'error';
  if (!hasProse(obs.body)) return 'empty';
  if (degradedFlag(obs)) return 'fallback';
  if (!attemptsOk || !validModel(obs.modelUsed)) return 'error';
  return obs.attempts === 1 ? 'model_ok' : 'retry_ok';
}
