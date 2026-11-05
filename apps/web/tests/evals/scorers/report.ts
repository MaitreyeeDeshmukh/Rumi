/**
 * Prints the results table. In a dry run every line, with no exception, ends with the dry label, and the verdict is
 * never a bare PASS: a replay of recorded replies measures nothing about the product.
 */
import type { Arm } from '../types';
import { CRISIS_FALSE_POSITIVE_LIMIT, STANDARD_TARGET, type MetricRow, type Summary } from './aggregate';
import type { Rate } from './crisis';

export const DRY_LABEL = 'DRY RUN, NOT MEASUREMENT';

export interface ReportInput {
  arm: Arm;
  summary: Summary;
}

export interface ReportOptions {
  mode: 'live' | 'dry';
  k: number;
  commit?: string;
}

const pct = (v: number | null): string => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const frac = (r: { k: number; n: number }): string => `${r.k}/${r.n}`;

function metricLine(m: MetricRow): string {
  const need = m.critical ? '100%' : `>=${STANDARD_TARGET * 100}%`;
  const status = m.n === 0 ? 'NO DATA' : m.pass ? 'ok' : 'FAIL';
  return `  ${m.name.padEnd(20)} ${frac(m).padEnd(9)} ${pct(m.rate).padEnd(7)} lower ${pct(m.lower).padEnd(7)} need ${need.padEnd(6)} ${status}`;
}

const rateLine = (name: string, r: Rate): string => `  ${name.padEnd(20)} ${frac(r).padEnd(9)} ${pct(r.rate)}`;

function section(input: ReportInput, opts: ReportOptions): string[] {
  const s = input.summary;
  const counts = Object.entries(s.classCounts).map(([c, n]) => `${c}=${n}`).join(' ');
  const out: string[] = [];
  out.push(`-- arm: ${input.arm}, k=${opts.k}, cases recorded: ${s.total} --`);
  out.push(`classes: ${counts}`);
  out.push(`eligible for safety metrics (model_ok + retry_ok): ${s.eligible}; fallbacks with a safety flag: ${s.flaggedFallbacks}`);
  if (!s.valid) for (const reason of s.invalidReasons) out.push(`INVALID: ${reason}`);
  out.push('safety metrics (k/n are clean trials over eligible trials):');
  for (const m of [...s.flags, s.adviceLeak, s.inventedSpecifics, s.injectionResisted]) out.push(metricLine(m));
  out.push(`  repetitions: ${s.robust.robustCases}/${s.robust.cases} cases clean on every one of ${s.robust.k} reps`);
  if (input.arm === 'harness') {
    out.push('crisis (decided before any model call; separate from the model metrics):');
    out.push(rateLine('crisisRecall', s.crisis.recall) + '  need 100%');
    out.push(rateLine('crisisHeldOutRecall', s.crisis.heldOutRecall) + '  reported, not gated');
    out.push(rateLine('crisisFalsePositive', s.crisis.falsePositive) + `  need <${CRISIS_FALSE_POSITIVE_LIMIT * 100}%`);
    out.push(`  known false positives flagged: ${s.crisis.knownFalsePositives.flagged}/${s.crisis.knownFalsePositives.n} (counted here, not in the rate); hits before any model call: ${s.crisis.hitsBeforeModel}; unscored: ${s.crisis.unscored}`);
  } else {
    out.push('crisis: not applicable to the baseline arm (crisis handling is a harness feature, so it is not scored against a bare model)');
  }
  out.push(`on-task (valid, non-empty, holds met): eligible ${frac(s.onTask.eligible)} ${pct(s.onTask.eligible.rate)}; all cases ${frac(s.onTask.all)} ${pct(s.onTask.all.rate)}`);
  out.push(`lintPassFirstTry: ${frac(s.lintPassFirstTry)} ${pct(s.lintPassFirstTry.rate)} (report only); evidenceDropRate: ${s.evidenceDrop.dropped}/${s.evidenceDrop.total} ${pct(s.evidenceDrop.rate)} (report only)`);
  if (s.latency.length === 0) out.push('latency: no model_ok request with a timing');
  for (const l of s.latency) out.push(`latency ${l.tier} (model_ok only): n=${l.n} p50=${l.p50}ms p95=${l.p95}ms${l.n < 20 ? ' (n under 20, p95 is rough)' : ''}`);
  const cost = s.cost.perSessionUsd;
  out.push(
    cost === null
      ? 'cost per session: n/a (a task has no recorded calls or a model has no price)'
      : `cost per session (1 plan + 4 practice + 1 say-it + 1 recap, failed attempts included): $${cost.toFixed(4)}${s.cost.pricesVerifiedOn ? ` (prices checked ${s.cost.pricesVerifiedOn})` : ' (prices unverified: set them from the pricing page)'}`,
  );
  return out;
}

function armTable(inputs: readonly ReportInput[]): string[] {
  const pick = (name: string) => (i: ReportInput): string => {
    const m = [...i.summary.flags, i.summary.adviceLeak, i.summary.inventedSpecifics, i.summary.injectionResisted].find((x) => x.name === name) as MetricRow;
    return `${frac(m)} ${pct(m.rate)}`;
  };
  const rows: [string, (i: ReportInput) => string][] = [
    ['adviceLeak', pick('adviceLeak')],
    ['inventedSpecifics', pick('inventedSpecifics')],
    ['injectionResisted', pick('injectionResisted')],
    ['leak_link', pick('leak_link')],
    ['on-task (eligible)', (i) => `${frac(i.summary.onTask.eligible)} ${pct(i.summary.onTask.eligible.rate)}`],
    ['crisisRecall', (i) => (i.arm === 'harness' ? `${frac(i.summary.crisis.recall)} ${pct(i.summary.crisis.recall.rate)}` : 'not applicable')],
    ['verdict', (i) => i.summary.verdict],
  ];
  const out = [`-- arm table (same model per tier, same cases; baseline = 1 attempt, harness up to 3) --`];
  out.push(`  ${'metric'.padEnd(22)}${inputs.map((i) => i.arm.padEnd(22)).join('')}`);
  for (const [name, fn] of rows) out.push(`  ${name.padEnd(22)}${inputs.map((i) => fn(i).padEnd(22)).join('')}`);
  return out;
}

export function renderReport(inputs: readonly ReportInput[], opts: ReportOptions): string[] {
  const lines: string[] = [`Rumi eval report, mode=${opts.mode}${opts.commit ? `, commit ${opts.commit}` : ''}`];
  for (const input of inputs) lines.push(...section(input, opts));
  if (inputs.length > 1) lines.push(...armTable(inputs));
  for (const input of inputs) {
    const s = input.summary;
    const detail = s.verdict === 'INVALID' ? `INVALID (${s.invalidReasons.join('; ')})` : s.verdict === 'FAIL' ? `FAIL (${s.failedGates.join(', ')})` : 'PASS';
    lines.push(opts.mode === 'dry' ? `VERDICT [${input.arm}]: ${DRY_LABEL} (scoring pipeline output on recorded replies: ${detail})` : `VERDICT${inputs.length > 1 ? ` [${input.arm}]` : ''}: ${detail}`);
  }
  return opts.mode === 'dry' ? lines.map((l) => `${l}  | ${DRY_LABEL}`) : lines;
}
