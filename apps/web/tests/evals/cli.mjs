/**
 * Entry point of `pnpm eval`. Vitest rejects flags it does not know, so this wrapper turns ours into environment variables
 * (read back by flags.ts) and then starts vitest with the eval config. Unknown flags stop the run: a typo such as --dyr must
 * never silently start a live run.
 *
 * Exit codes:
 *   0  every arm ran and is PASS (or the baseline is COMPARISON); a consistent --dry replay and a clean --self-test also exit 0
 *   1  refused or misused: live run refused (MOCK_AI set, no key, no live adapter, spec drift), an arm that never started, or vitest failed without a verdict
 *   2  bad flag
 *   3  FAIL: valid run, the HARNESS arm missed a gate (a --dry-fault=seeded replay and a failing --self-test exit 3). The baseline arm never FAILs the run
 *   4  INVALID: the run cannot be trusted (error|mock|empty cases, fallback over 20%, missing data) (--dry-fault=error|mock|empty exit 4)
 * The verdicts reach this process through a temporary status file named by EVAL_STATUS_FILE.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VALUE_FLAGS = {
  arm: 'EVAL_ARM',
  k: 'EVAL_K',
  'dry-fault': 'EVAL_FAULT',
  'human-sheet': 'EVAL_HUMAN_SHEET',
  'human-key': 'EVAL_HUMAN_KEY',
  'human-ratings': 'EVAL_HUMAN_RATINGS',
  'human-lanes': 'EVAL_HUMAN_LANES',
};
const BOOLEAN_FLAGS = { dry: 'EVAL_DRY', release: 'EVAL_RELEASE', 'self-test': 'EVAL_SELFTEST' };

/**
 * EVAL_MODE=1 is always set: the harness honours it only outside production (D32).
 * @param {readonly string[]} argv
 * @returns {Record<string, string>}
 */
export function argvToEnv(argv) {
  /** @type {Record<string, string>} */
  const env = { EVAL_MODE: '1' };
  for (const arg of argv) {
    const bool = Object.entries(BOOLEAN_FLAGS).find(([name]) => arg === `--${name}`);
    const val = Object.entries(VALUE_FLAGS).find(([name]) => arg.startsWith(`--${name}=`));
    if (bool) env[bool[1]] = '1';
    else if (val) env[val[1]] = arg.slice(val[0].length + 3);
    else throw new Error(`Unknown flag ${arg}. Flags: --dry --release --arm=harness|baseline|both --k=N --dry-fault=error|mock|empty|seeded --human-sheet=F --human-key=F --human-ratings=F --human-lanes=F --self-test`);
  }
  if (env.EVAL_DRY && env.EVAL_RELEASE) throw new Error('--release writes a committed result and a dry run is not a measurement: --dry --release is refused');
  const human = ['EVAL_HUMAN_SHEET', 'EVAL_HUMAN_KEY', 'EVAL_HUMAN_RATINGS', 'EVAL_HUMAN_LANES'].filter((k) => env[k]);
  // The lanes file is required so that "builders do not score their own lane" cannot be skipped by leaving it out ({} is allowed and explicit).
  if (human.length > 0 && human.length < 4) throw new Error('the human read needs --human-sheet, --human-key, --human-ratings and --human-lanes together');
  if (env.EVAL_SELFTEST && Object.keys(env).some((k) => k !== 'EVAL_MODE' && k !== 'EVAL_SELFTEST')) throw new Error('--self-test runs alone');
  if (human.length > 0 && (env.EVAL_DRY || env.EVAL_RELEASE || env.EVAL_FAULT)) throw new Error('the human read does not combine with --dry, --release or --dry-fault');
  return env;
}

/**
 * @param {readonly string[]} verdicts  one of PASS | FAIL | INVALID | COMPARISON per arm
 * @param {number} vitestStatus
 * @param {number} [expected] how many arms were asked to run
 * @param {boolean} [skipped] the live run was skipped because GROQ_API_KEY is not set
 * @returns {number}
 */
export function exitCodeFor(verdicts, vitestStatus, expected = verdicts.length, skipped = false) {
  // A live run with no GROQ_API_KEY prints one line and stops: nothing was measured, nothing failed.
  if (skipped) return vitestStatus === 0 ? 0 : 1;
  // An arm that never started leaves no verdict: that is misuse (1), not a result, even if the other arm failed.
  if (verdicts.length === 0 || verdicts.length !== expected) return 1;
  if (verdicts.includes('INVALID')) return 4;
  if (verdicts.includes('FAIL')) return 3;
  // COMPARISON is a valid baseline that missed some gates: the baseline is a yardstick and never fails the run.
  if (verdicts.every((v) => v === 'PASS' || v === 'COMPARISON')) return vitestStatus === 0 ? 0 : 1;
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let env;
  try {
    env = argvToEnv(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'rumi-eval-status-'));
  const statusFile = path.join(dir, 'status.json');
  const file = env.EVAL_HUMAN_SHEET ? 'tests/evals/human.eval.ts' : env.EVAL_SELFTEST ? 'tests/evals/selftest.eval.ts' : 'tests/evals/run.eval.ts';
  const r = spawnSync(process.execPath, [vitest, 'run', '-c', 'vitest.eval.config.mts', file], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env, EVAL_STATUS_FILE: statusFile },
  });
  let verdicts = [];
  let expected;
  let skipped = false;
  try {
    const status = JSON.parse(readFileSync(statusFile, 'utf8'));
    verdicts = status.verdicts ?? [];
    expected = status.expected;
    skipped = status.skipped === true;
  } catch {
    // No status file: the run stopped before it had a verdict (refused, crashed). exitCodeFor turns that into 1.
  }
  rmSync(dir, { recursive: true, force: true });
  const code = env.EVAL_HUMAN_SHEET ? (r.status ?? 1) : exitCodeFor(verdicts, r.status ?? 1, expected, skipped);
  console.error(`pnpm eval exit code ${code}${verdicts.length ? ` (verdicts: ${verdicts.join(', ')})` : ''}`);
  process.exit(code);
}
