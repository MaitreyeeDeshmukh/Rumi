/**
 * Command-line flags for `pnpm eval`. cli.mjs turns argv into environment variables (vitest rejects flags it does not know);
 * `readFlags` reads them back inside the eval file.
 *
 *   pnpm eval                      live, both arms, k=3 (needs GROQ_API_KEY in apps/web/.env.local, MOCK_AI unset)
 *   pnpm eval --dry                replay recorded fixture replies; labelled DRY RUN, NOT MEASUREMENT; writes nothing
 *   pnpm eval --arm=baseline       one arm only (harness | baseline | both)
 *   pnpm eval --k=1                repetitions per case (crisis cases always run once)
 *   pnpm eval --dry --dry-fault=error|mock|empty|seeded   show how a bad run is reported
 *   pnpm eval --release            also write the counts-only tests/evals/eval-summary.json (live runs only; refused with --dry)
 *   pnpm eval --human-sheet=S --human-key=K --human-ratings=R [--human-lanes=L]   score the 20-output human read
 *
 * Exit codes are listed in cli.mjs (0 pass, 1 refused or misused, 2 bad flag, 3 FAIL, 4 INVALID).
 */
import type { Arm } from './types';

export const DRY_FAULTS = ['error', 'mock', 'empty', 'seeded'] as const;
export type DryFault = (typeof DRY_FAULTS)[number];

export interface EvalFlags {
  dry: boolean;
  arms: Arm[];
  k: number;
  release: boolean;
  fault?: DryFault;
}

export function readFlags(env: Record<string, string | undefined>): EvalFlags {
  const armRaw = env.EVAL_ARM ?? 'both';
  if (!['harness', 'baseline', 'both'].includes(armRaw)) throw new Error(`--arm must be harness, baseline or both (got ${armRaw})`);
  const k = env.EVAL_K === undefined ? 3 : Number(env.EVAL_K);
  if (!Number.isInteger(k) || k < 1 || k > 10) throw new Error('--k must be a whole number from 1 to 10');
  const fault = env.EVAL_FAULT as DryFault | undefined;
  if (fault !== undefined && !DRY_FAULTS.includes(fault)) throw new Error(`--dry-fault must be one of ${DRY_FAULTS.join(', ')}`);
  const dry = env.EVAL_DRY === '1';
  if (fault && !dry) throw new Error('--dry-fault only makes sense together with --dry');
  if (dry && env.EVAL_RELEASE === '1') throw new Error('--release writes a committed result; a dry run is not a measurement, so --dry --release is refused');
  return { dry, arms: armRaw === 'both' ? ['harness', 'baseline'] : [armRaw as Arm], k, release: env.EVAL_RELEASE === '1', fault };
}
