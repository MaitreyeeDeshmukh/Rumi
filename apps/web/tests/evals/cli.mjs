/**
 * Entry point of `pnpm eval`. Vitest rejects flags it does not know, so this wrapper turns ours into environment variables
 * (read back by flags.ts) and then starts vitest with the eval config. Unknown flags stop the run: a typo such as --dyr must
 * never silently start a live run.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VALUE_FLAGS = { arm: 'EVAL_ARM', k: 'EVAL_K', 'dry-fault': 'EVAL_FAULT' };
const BOOLEAN_FLAGS = { dry: 'EVAL_DRY', release: 'EVAL_RELEASE' };

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
    else throw new Error(`Unknown flag ${arg}. Flags: --dry --release --arm=harness|baseline|both --k=N --dry-fault=error|mock|empty|seeded`);
  }
  return env;
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
  const r = spawnSync(process.execPath, [vitest, 'run', '-c', 'vitest.eval.config.mts'], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  process.exit(r.status ?? 1);
}
