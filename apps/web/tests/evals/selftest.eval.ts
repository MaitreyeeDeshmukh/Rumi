/**
 * `pnpm eval --self-test`: proves the scorers against a seeded-bad and seeded-good corpus. No network, no key, writes nothing.
 * Exit code 3 (FAIL) if any scorer misses a bad item or flags a good one. See scorers/selftest.ts.
 */
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { runSelfTest } from './scorers/selftest';

it('self-test', () => {
  const { checked, failures } = runSelfTest();
  process.stdout.write(`self-test: ${checked} seeded items checked, ${failures.length} scorer problem(s)\n${failures.map((f) => `  ${f}`).join('\n')}${failures.length ? '\n' : ''}`);
  if (process.env.EVAL_STATUS_FILE) writeFileSync(process.env.EVAL_STATUS_FILE, JSON.stringify({ verdicts: [failures.length === 0 ? 'PASS' : 'FAIL'], expected: 1 }));
});
