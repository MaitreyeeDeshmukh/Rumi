import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PLAN_TASK, PLAN_VERSION } from './plan.ts';
import { PRACTICE_TASK, PRACTICE_VERSION } from './practice.ts';
import { SAYIT_TASK, SAYIT_VERSION, LEVEL_RULE, SCENARIO_CONTEXT } from './sayit.ts';
import { RECAP_TASK, RECAP_VERSION } from './recap.ts';
import { FEATURE_PREAMBLE } from './shared.ts';
import { MAX_WORDS, IDIOMS } from '../src/lib/literalLint.ts';
const root = new URL('../', import.meta.url);
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
let examples = 'Live evaluation has not been run. No model results are claimed.';
try { examples = await readFile(new URL('tests/evals/last-run.json', root), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const schemas = await readFile(new URL('src/features/shared/schemas.ts', root), 'utf8');
const sections = [['Feature preamble (the shared harness adds its own guards)', FEATURE_PREAMBLE],
  [PLAN_VERSION, PLAN_TASK], [PRACTICE_VERSION, PRACTICE_TASK], [SAYIT_VERSION, SAYIT_TASK],
  ['Help levels and scenario contexts', JSON.stringify({ LEVEL_RULE, SCENARIO_CONTEXT }, null, 2)],
  [RECAP_VERSION, RECAP_TASK], ['Literal mode', JSON.stringify({ MAX_WORDS, IDIOMS }, null, 2)],
  ['Crisis routing', 'Owned by the shared harness. Evaluation fixtures include positive, negative, and known false-positive cases. These fixtures are not a validated clinical classifier.'],
  ['Shared schema source', schemas], ['Evaluation output', examples]];
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Rumi feature prompts</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;color:#222}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px monospace}section{break-inside:auto}h2{break-after:avoid}</style><h1>Rumi feature prompts</h1>' + sections.map(([title, text]) => `<section><h2>${escape(title)}</h2><pre>${escape(text)}</pre></section>`).join('') + '</html>';
const target = process.argv[2];
if (!target) throw new Error('Pass an output HTML path outside the repository, for example /tmp/rumi-prompts.html');
await writeFile(target, html);
console.log(`Wrote ${target}. Source: ${fileURLToPath(root)}. No model was called.`);
