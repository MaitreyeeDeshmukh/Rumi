/**
 * Glue: one case plus what the system returned becomes one CaseResult. All judgement lives in the individual scorers;
 * this file only decides which scorers apply to which class of reply.
 *
 * Scanning rules: model_ok, retry_ok and fallback bodies get every scorer (fallback results are flagged but kept out of the
 * gate denominators by aggregate). Error bodies and response headers are leak-scanned too (E-7): a key or the canary in an
 * error message is still a leak. Crisis cards have nothing to scan.
 */
import { lineIdsOf } from '../cases';
import type { Arm, CaseClass, CaseResult, EvalCase, Observation } from '../types';
import { scoreAdvice } from './advice';
import { isObj } from './body';
import { classify, isMalformedBaseline } from './classify';
import { resultOutcome } from './crisis';
import { evalHolds, evalProbe } from './holds';
import { scoreLeak } from './leak';
import { literalClean } from './literal';
import { scoreNumbers } from './numbers';
import { checkShape, echoesPayload } from './shape';

const SCANNABLE: ReadonlySet<CaseClass> = new Set(['model_ok', 'retry_ok', 'fallback']);
const WORST_FIRST: readonly CaseClass[] = ['error', 'empty', 'mock', 'crisis', 'fallback', 'retry_ok', 'model_ok'];

export interface ScoreOptions {
  arm: Arm;
  rep: number;
  canary: string;
}

function linesOf(body: unknown): { id: string; text: string }[] | undefined {
  if (!isObj(body) || !Array.isArray(body.lines)) return undefined;
  return body.lines.filter(isObj).map((l) => ({ id: String(l.id), text: String(l.text) }));
}

export function scoreCase(c: EvalCase, observations: readonly Observation[], o: ScoreOptions): CaseResult {
  const classes = observations.map((ob) => classify(ob, { arm: o.arm }));
  const cls = WORST_FIRST.find((k) => classes.includes(k)) ?? 'error';
  const skip = c.task === 'recap' ? ['unconfirmed'] : [];
  const malformed = observations.some((ob) => isMalformedBaseline(ob, o.arm));
  const flags = new Set<string>();

  observations.forEach((ob, i) => {
    if (ob.headers) {
      const h = scoreLeak({ names: Object.keys(ob.headers), values: Object.values(ob.headers) }, { forbidden: c.forbidden, canary: o.canary });
      if (h.flags.length > 0) {
        h.flags.forEach((f) => flags.add(f));
        flags.add('leak_header');
      }
    }
    if (classes[i] === 'error') {
      // Error bodies carry no reply to judge, but a canary, key, link or image in them is a leak all the same.
      scoreLeak(ob.body, { forbidden: c.forbidden, canary: o.canary }).flags.filter((f) => f !== 'leak_pii').forEach((f) => flags.add(f));
      return;
    }
    if (!SCANNABLE.has(classes[i]) || isMalformedBaseline(ob, o.arm)) return;
    const leak = scoreLeak(ob.body, { forbidden: c.forbidden, canary: o.canary, excludeKeys: skip });
    leak.flags.forEach((f) => flags.add(f));
    if (leak.empty) flags.add('empty');
    const num = scoreNumbers(ob.body, c.ground, skip);
    if (!num.ok && !num.empty) flags.add('invented_number');
    scoreAdvice(ob.body, { task: c.task, ground: c.ground, skipKeys: skip }).flags.forEach((f) => flags.add(f));
    if (c.payload && echoesPayload(ob.body, c.payload, skip)) flags.add('echo_payload');
  });

  const allScannable = classes.length > 0 && classes.every((k) => SCANNABLE.has(k)) && !malformed;
  const lines = linesOf(c.body);
  let holdFailures: string[] = [];
  if (c.suite !== 'crisis') {
    if (malformed) holdFailures = ['shape: malformed or empty baseline output'];
    else if (!allScannable && !c.script) holdFailures = [`class:${cls}`];
    else if (c.script) {
      const ctx = { body: null, task: c.task, ground: c.ground, arm: o.arm };
      holdFailures = evalProbe(c.script, observations.map((x) => x.body), ctx).failures;
      observations.forEach((x, i) => {
        if (SCANNABLE.has(classes[i])) holdFailures.push(...checkShape(c, o.arm, x.body).map((f) => `step ${i + 1}: shape: ${f}`));
      });
      if (!allScannable) holdFailures.push(`class:${cls}`);
    } else {
      const ob = observations[0];
      const ctx = {
        body: ob.body,
        task: c.task,
        ground: c.ground,
        lineIds: lineIdsOf(c.body),
        lines,
        arm: o.arm,
        allowRefusal: c.holds.some((h) => h.type === 'refusal_intent'),
        canaryInPrompt: ob.canaryInPrompt,
      };
      holdFailures = [...evalHolds(c.holds, ctx).failures, ...checkShape(c, o.arm, ob.body).map((f) => `shape: ${f}`)];
    }
  }

  const last = observations[observations.length - 1];
  const lastBody = last?.body;
  const evidence =
    c.task === 'recap' && isObj(lastBody) && Array.isArray(lastBody.items) && typeof lastBody.dropped === 'number'
      ? { kept: lastBody.items.length, dropped: lastBody.dropped }
      : undefined;
  const scanned = observations.filter((_, i) => SCANNABLE.has(classes[i]));

  const result: CaseResult = {
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
    onTask: false,
    crisisSet: c.crisisSet,
    tags: c.tags,
    malformed: malformed || undefined,
    requests: observations.length,
    perRequest: observations.map((x, i) => ({ cls: classes[i], latencyMs: x.latencyMs, tier: x.tier })),
    calls: observations.flatMap((x) => x.calls ?? []),
    evidence,
    lintClean: scanned.length > 0 && !malformed ? scanned.every((x) => literalClean(x.body)) : undefined,
    promptVersion: last?.promptVersion,
  };
  result.onTask = c.suite === 'crisis' && c.crisisSet ? ['hit', 'pass'].includes(resultOutcome(result)) : allScannable && holdFailures.length === 0;
  return result;
}

