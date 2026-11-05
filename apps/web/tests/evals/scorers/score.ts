/**
 * Glue: one case plus what the system returned becomes one CaseResult. All judgement lives in the individual scorers;
 * this file only decides which scorers apply to which class of reply.
 */
import { lineIdsOf } from '../cases';
import type { Arm, CaseClass, CaseResult, EvalCase, Observation } from '../types';
import { scoreAdvice } from './advice';
import { isObj } from './body';
import { classify } from './classify';
import { crisisOutcome } from './crisis';
import { evalHolds, evalProbe } from './holds';
import { scoreLeak } from './leak';
import { literalClean } from './literal';
import { scoreNumbers } from './numbers';

/** Replies that carry a body worth scanning. Crisis cards and errors have nothing to scan. */
const SCANNABLE: ReadonlySet<CaseClass> = new Set(['model_ok', 'retry_ok', 'fallback']);
const WORST_FIRST: readonly CaseClass[] = ['error', 'empty', 'mock', 'crisis', 'fallback', 'retry_ok', 'model_ok'];

export interface ScoreOptions {
  arm: Arm;
  rep: number;
  canary: string;
}

export function scoreCase(c: EvalCase, observations: readonly Observation[], o: ScoreOptions): CaseResult {
  const classes = observations.map(classify);
  const cls = WORST_FIRST.find((k) => classes.includes(k)) ?? 'error';
  const skip = c.task === 'recap' ? ['unconfirmed'] : [];
  const flags = new Set<string>();

  observations.forEach((ob, i) => {
    if (!SCANNABLE.has(classes[i])) return;
    const leak = scoreLeak(ob.body, { forbidden: c.forbidden, canary: o.canary, excludeKeys: skip });
    leak.flags.forEach((f) => flags.add(f));
    if (leak.empty) flags.add('empty');
    const num = scoreNumbers(ob.body, c.ground, skip);
    if (!num.ok && !num.empty) flags.add('invented_number');
    scoreAdvice(ob.body, { task: c.task, ground: c.ground, skipKeys: skip }).flags.forEach((f) => flags.add(f));
  });

  const allScannable = classes.length > 0 && classes.every((k) => SCANNABLE.has(k));
  let holdFailures: string[] = [];
  if (c.suite !== 'crisis') {
    if (!allScannable && !c.script) holdFailures = [`class:${cls}`];
    else if (c.script) {
      holdFailures = evalProbe(c.script, observations.map((x) => x.body), { body: null, task: c.task, ground: c.ground }).failures;
      if (!allScannable) holdFailures.push(`class:${cls}`);
    } else {
      holdFailures = evalHolds(c.holds, { body: observations[0].body, task: c.task, ground: c.ground, lineIds: lineIdsOf(c.body) }).failures;
    }
  }

  const last = observations[observations.length - 1];
  const lastBody = last?.body;
  const evidence =
    c.task === 'recap' && isObj(lastBody) && Array.isArray(lastBody.items) && typeof lastBody.dropped === 'number'
      ? { kept: lastBody.items.length, dropped: lastBody.dropped }
      : undefined;
  const scanned = observations.filter((_, i) => SCANNABLE.has(classes[i]));

  const onTask =
    c.suite === 'crisis' && c.crisisSet
      ? ['hit', 'pass'].includes(crisisOutcome(c.crisisSet, cls))
      : allScannable && holdFailures.length === 0;

  return {
    caseId: c.id,
    suite: c.suite,
    task: c.task,
    arm: o.arm,
    rep: o.rep,
    cls,
    modelUsed: last?.modelUsed ?? null,
    attempts: observations.reduce((a, x) => a + x.attempts, 0),
    flags: [...flags],
    holdFailures,
    onTask,
    crisisSet: c.crisisSet,
    requests: observations.length,
    perRequest: observations.map((x, i) => ({ cls: classes[i], latencyMs: x.latencyMs, tier: x.tier })),
    calls: observations.flatMap((x) => x.calls ?? []),
    evidence,
    lintClean: scanned.length > 0 ? scanned.every((x) => literalClean(x.body)) : undefined,
    promptVersion: last?.promptVersion,
  };
}
