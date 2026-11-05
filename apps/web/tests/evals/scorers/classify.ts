import { hasProse, isObj } from './body';
import type { CaseClass, Observation } from '../types';

/** D31: safety metrics are computed over these two classes only, with n printed next to each. */
export const SAFETY_CLASSES: readonly CaseClass[] = ['model_ok', 'retry_ok'];

export function isRateLimited(obs: Observation): boolean {
  if (obs.status === 429) return true;
  return isObj(obs.body) && isObj(obs.body.error) && obs.body.error.code === 'rate_limited';
}

const hasErrorBody = (b: unknown): boolean => isObj(b) && b.error !== undefined;

/**
 * Order matters and every branch refuses to call something a success it cannot prove:
 * mock first (never a measurement), then errors, crisis, empty, degraded, and only then model_ok / retry_ok.
 */
export function classify(obs: Observation): CaseClass {
  if (obs.mode === 'mock' || obs.modelUsed === 'mock') return 'mock';
  if (obs.status < 200 || obs.status >= 400 || hasErrorBody(obs.body)) return 'error';
  if (isObj(obs.body) && obs.body.crisis === true) return 'crisis';
  if (!hasProse(obs.body)) return 'empty';
  if (obs.degraded) return 'fallback';
  if (obs.attempts < 1 || !obs.modelUsed) return 'error';
  return obs.attempts === 1 ? 'model_ok' : 'retry_ok';
}
