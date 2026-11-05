/**
 * Turns the dataset files into runnable cases. Pure: no network, no env. Each case carries the texts its reply may take
 * numbers from (`ground`) so the scorers never need the harness's own ledger.
 */
import type { EvalData } from './data/schema';
import { allStrings, isObj } from './scorers/body';
import type { Arm, CrisisSet, EvalCase, Hold, TaskName } from './types';

const COMPANION = 'Jo';

const DEFAULT_HOLDS: Hold[] = [{ type: 'valid_reply' }, { type: 'not_crisis' }, { type: 'no_advice' }, { type: 'no_invented_numbers' }, { type: 'no_links' }];
const RECAP_HOLDS: Hold[] = [{ type: 'valid_reply' }, { type: 'no_advice' }, { type: 'no_invented_numbers' }, { type: 'no_links' }, { type: 'every_item_cites_input_line' }, { type: 'items_supported_by_cited_lines' }];

const pathFor = (task: TaskName): string => `/api/${task}`;

/** Sets a dotted path on a deep copy. The path must already exist (the dataset schema checks this). */
export function setPath<T>(base: T, path: string, value: unknown): T {
  const copy = structuredClone(base);
  const parts = path.split('.');
  let cur: unknown = copy;
  for (const part of parts.slice(0, -1)) {
    cur = Array.isArray(cur) ? cur[Number(part)] : isObj(cur) ? cur[part] : undefined;
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur)) cur[Number(last)] = value;
  else if (isObj(cur)) cur[last] = value;
  else throw new Error(`setPath: ${path} does not exist`);
  return copy;
}

const planTexts = (plan: { mainConcern: string; symptomsInMyWords: string[]; items: { text: string }[] }): string[] => [
  plan.mainConcern,
  ...plan.symptomsInMyWords,
  ...plan.items.map((i) => i.text),
];

export function lineIdsOf(body: unknown): string[] | undefined {
  if (!isObj(body) || !Array.isArray(body.lines)) return undefined;
  return body.lines.filter(isObj).map((l) => String(l.id));
}

const OPENER = { role: 'clinician', text: 'Hello. What would you like to talk about?' } as const;

/**
 * The crisis suite. Plan texts go through `rawText`; the other typed crisis fields of task.ts (`crisisFields`) are the latest
 * "me" turn in practice and `clinicianQuestion` in say-it. A clinician turn that mentions a crisis word must NOT trigger (D2).
 */
function crisisCases(data: EvalData): EvalCase[] {
  const mk = (id: string, task: 'plan' | 'practice' | 'sayit', body: unknown, text: string, set: CrisisSet): EvalCase => ({
    id: `crisis:${id}`, suite: 'crisis', task, path: pathFor(task), body, ground: [text], forbidden: [],
    holds: set === 'negative' ? [{ type: 'valid_reply' }] : [], crisisSet: set,
  });
  const n = (i: number) => String(i + 1).padStart(2, '0');
  const plan = (id: string, texts: readonly string[], set: CrisisSet) =>
    texts.map((t, i) => mk(`${id}:${n(i)}`, 'plan', { rawText: t, companionName: COMPANION }, t, set));
  const practicePlan = data.redteam.bases.practice.plan;
  return [
    ...plan('positive', data.crisis.positive, 'positive'),
    ...plan('heldOut', data.crisis.heldOutPositive, 'heldOut'),
    ...plan('negative', data.crisis.negative, 'negative'),
    ...plan('knownFalsePositive', data.crisis.knownFalsePositives, 'knownFalsePositive'),
    ...plan('knownHard', data.crisis.knownHard, 'knownHard'),
    ...plan('messy', data.crisis.messyPositive, 'messy'),
    ...data.crisis.fieldPositive.practice.map((t, i) =>
      mk(`field-practice:${n(i)}`, 'practice', { plan: practicePlan, turns: [OPENER, { role: 'me', text: t }], focus: 'whole', companionName: COMPANION }, t, 'field')),
    ...data.crisis.fieldPositive.sayit.map((t, i) =>
      mk(`field-sayit:${n(i)}`, 'sayit', { level: 2, clinicianQuestion: t, companionName: COMPANION }, t, 'field')),
    ...data.crisis.practiceClinicianNegative.map((x, i) =>
      mk(`negative-turn:${n(i)}`, 'practice', { plan: practicePlan, turns: [{ role: 'clinician', text: x.clinician }, { role: 'me', text: x.me }], focus: 'whole', companionName: COMPANION }, `${x.clinician} ${x.me}`, 'negative')),
  ];
}

export function buildCases(data: EvalData, arm: Arm): EvalCase[] {
  const cases: EvalCase[] = [];

  for (const p of data.plan) {
    cases.push({ id: `plan:${p.id}`, suite: 'plan', task: 'plan', path: pathFor('plan'), body: { rawText: p.rawText, companionName: COMPANION }, ground: [p.rawText], forbidden: [], holds: DEFAULT_HOLDS, tags: p.tags });
  }

  for (const c of data.practice.cases) {
    const body = { plan: c.plan, turns: c.turns, focus: c.focus, companionName: COMPANION };
    cases.push({ id: `practice:${c.id}`, suite: 'practice', task: 'practice', path: pathFor('practice'), body, ground: [...planTexts(c.plan), ...c.turns.map((t) => t.text)], forbidden: [], holds: DEFAULT_HOLDS, harnessHolds: c.holds });
  }
  for (const p of data.practice.probes) {
    cases.push({
      id: `practice:${p.id}`,
      suite: 'practice',
      task: 'practice',
      path: pathFor('practice'),
      body: { plan: p.plan, turns: [], focus: p.focus, companionName: COMPANION },
      ground: [...planTexts(p.plan), p.opener, ...p.steps.map((s) => s.me)],
      forbidden: [],
      holds: [],
      script: { opener: p.opener, steps: p.steps, distinctReplies: p.distinctReplies },
    });
  }

  for (const s of data.sayit) {
    const body = { level: s.level, scenario: s.scenario, clinicianQuestion: s.clinicianQuestion, mainConcern: s.mainConcern, symptomsInMyWords: s.symptomsInMyWords, companionName: COMPANION };
    const ground = [s.mainConcern ?? '', ...(s.symptomsInMyWords ?? []), s.clinicianQuestion ?? ''].filter(Boolean);
    cases.push({ id: `sayit:${s.id}`, suite: 'sayit', task: 'sayit', path: pathFor('sayit'), body: JSON.parse(JSON.stringify(body)), ground, forbidden: [], holds: DEFAULT_HOLDS });
  }

  for (const r of data.recap) {
    const body = { lines: r.lines, mySpeaker: r.mySpeaker, plan: r.plan };
    const ground = [...r.lines.map((l) => l.text), ...(r.plan ? planTexts(r.plan) : [])];
    cases.push({ id: `recap:${r.id}`, suite: 'recap', task: 'recap', path: pathFor('recap'), body: JSON.parse(JSON.stringify(body)), ground, forbidden: [], holds: [...RECAP_HOLDS, ...r.holds] });
  }

  for (const row of data.redteam.rows) {
    const base = data.redteam.bases[row.task];
    // Numbers and doses are judged against the clean base: text that arrived inside the payload is never "grounded".
    const ground = allStrings(setPath(base, row.field, ''));
    const body = setPath(base, row.field, row.payload);
    cases.push({ id: `redteam:${row.id}`, suite: 'redteam', task: row.task, path: pathFor(row.task), body, ground, forbidden: row.forbidden, holds: row.mustHold, memory: row.memory, payload: row.payload, seedMarker: row.marker, arms: row.arms });
  }

  for (const s of data.scenarios) {
    cases.push({ id: `scenario:${s.id}`, suite: 'scenario', task: s.task, path: pathFor(s.task), body: s.input, ground: allStrings(s.input), forbidden: s.forbidden, holds: s.mustHold });
  }

  // Crisis detection is a harness feature, so the plain-model baseline arm is not asked to do it (reported as "not applicable").
  if (arm === 'harness') cases.push(...crisisCases(data));
  return cases.filter((c) => !c.arms || c.arms.includes(arm));
}

