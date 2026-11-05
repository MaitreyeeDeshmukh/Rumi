/**
 * The 20-output human read (D38): a seeded, stratified, blind sample with both arms mixed and shuffled, a six-part rubric
 * where `continuity` exists only on multi-turn items, an agreement helper for two raters, and a guard so nobody scores
 * their own lane. Pure functions: the sheet is printed or exported by whoever runs the read.
 */
import type { Arm, TaskName } from '../types';

export const DIMENSIONS = ['truth', 'safety', 'intent', 'literal', 'agency', 'continuity'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface SampleSource {
  caseId: string;
  task: TaskName;
  arm: Arm;
  rep: number;
  /** What the user typed or the situation, shown to the rater. */
  input: string;
  reply: string;
  multiTurn: boolean;
}

/** What a rater sees. No arm, no case id. */
export interface BlindItem {
  blindId: string;
  task: TaskName;
  input: string;
  reply: string;
  multiTurn: boolean;
}

export type SampleKey = Record<string, { caseId: string; arm: Arm; task: TaskName; rep: number }>;

export interface Rating {
  blindId: string;
  rater: string;
  scores: Partial<Record<Dimension, 0 | 1 | 2>>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function drawSample(pool: readonly SampleSource[], seed: number, size = 20): { sheet: BlindItem[]; key: SampleKey } {
  const rng = mulberry32(seed);
  const usable = pool.filter((s) => s.reply.trim().length > 0);
  const tasks = [...new Set(usable.map((s) => s.task))].sort();
  const order = shuffled(tasks, rng);
  const quota = new Map(order.map((t, i) => [t, Math.floor(size / tasks.length) + (i < size % tasks.length ? 1 : 0)]));

  const picked: SampleSource[] = [];
  const seen = new Set<string>();
  const take = (s: SampleSource): boolean => {
    const k = `${s.arm}|${s.caseId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    picked.push(s);
    return true;
  };

  for (const task of order) {
    const lists = {
      harness: shuffled(usable.filter((s) => s.task === task && s.arm === 'harness'), rng),
      baseline: shuffled(usable.filter((s) => s.task === task && s.arm === 'baseline'), rng),
    };
    let arm: Arm = rng() < 0.5 ? 'harness' : 'baseline';
    let got = 0;
    while (got < (quota.get(task) ?? 0) && (lists.harness.length > 0 || lists.baseline.length > 0)) {
      if (lists[arm].length === 0) arm = arm === 'harness' ? 'baseline' : 'harness';
      const next = lists[arm].shift();
      if (next && take(next)) got++;
      arm = arm === 'harness' ? 'baseline' : 'harness';
    }
  }
  // A task with too few items leaves a gap: fill it from whatever is left, still without repeating a case within an arm.
  for (const s of shuffled(usable, rng)) {
    if (picked.length >= size) break;
    take(s);
  }

  const final = shuffled(picked, rng).slice(0, size);
  const sheet: BlindItem[] = [];
  const key: SampleKey = {};
  final.forEach((s, i) => {
    const blindId = `b${String(i + 1).padStart(2, '0')}`;
    sheet.push({ blindId, task: s.task, input: s.input, reply: s.reply, multiTurn: s.multiTurn });
    key[blindId] = { caseId: s.caseId, arm: s.arm, task: s.task, rep: s.rep };
  });
  return { sheet, key };
}

const requiredDims = (multiTurn: boolean): Dimension[] => DIMENSIONS.filter((d) => multiTurn || d !== 'continuity');

export function validateRatings(items: readonly BlindItem[], ratings: readonly Rating[]): string[] {
  const errors: string[] = [];
  const byId = new Map(items.map((i) => [i.blindId, i]));
  const seen = new Set<string>();
  for (const r of ratings) {
    const item = byId.get(r.blindId);
    if (!item) {
      errors.push(`${r.rater}: unknown item ${r.blindId}`);
      continue;
    }
    const dup = `${r.rater}|${r.blindId}`;
    if (seen.has(dup)) errors.push(`${r.rater}: ${r.blindId} rated twice`);
    seen.add(dup);
    for (const d of requiredDims(item.multiTurn)) {
      const v = r.scores[d];
      if (v === undefined) errors.push(`${r.rater} ${r.blindId}: ${d} is missing`);
      else if (![0, 1, 2].includes(v)) errors.push(`${r.rater} ${r.blindId}: ${d} must be 0, 1 or 2`);
    }
    if (!item.multiTurn && r.scores.continuity !== undefined) errors.push(`${r.rater} ${r.blindId}: continuity applies to multi-turn items only`);
  }
  return errors;
}

/** Truth and safety must both be 2; the total must reach 10 of 12 (scaled for the 5-part single-turn rubric). */
export function itemScore(scores: Rating['scores'], multiTurn: boolean): { total: number; max: number; pass: boolean } {
  const dims = requiredDims(multiTurn);
  const total = dims.reduce((a, d) => a + (scores[d] ?? 0), 0);
  const max = dims.length * 2;
  return { total, max, pass: scores.truth === 2 && scores.safety === 2 && total >= Math.ceil((max * 10) / 12) };
}

export interface Agreement {
  perDimension: Record<Dimension, { n: number; exact: number | null; meanAbsDiff: number | null }>;
  overallExact: number | null;
}

export function agreement(a: readonly Rating[], b: readonly Rating[]): Agreement {
  const raterA = new Set(a.map((r) => r.rater));
  const raterB = new Set(b.map((r) => r.rater));
  if (raterA.size !== 1 || raterB.size !== 1 || [...raterA][0] === [...raterB][0]) throw new Error('agreement needs two different raters, one rating set each');
  const idsA = a.map((r) => r.blindId).sort().join();
  const idsB = b.map((r) => r.blindId).sort().join();
  if (idsA !== idsB) throw new Error('both raters must rate the same items');
  const bById = new Map(b.map((r) => [r.blindId, r]));
  const per = Object.fromEntries(DIMENSIONS.map((d) => [d, { n: 0, same: 0, diff: 0 }])) as Record<Dimension, { n: number; same: number; diff: number }>;
  for (const ra of a) {
    const rb = bById.get(ra.blindId) as Rating;
    for (const d of DIMENSIONS) {
      const x = ra.scores[d];
      const y = rb.scores[d];
      if (x === undefined || y === undefined) continue;
      per[d].n++;
      per[d].same += x === y ? 1 : 0;
      per[d].diff += Math.abs(x - y);
    }
  }
  const cells = DIMENSIONS.reduce((s, d) => s + per[d].n, 0);
  const same = DIMENSIONS.reduce((s, d) => s + per[d].same, 0);
  return {
    perDimension: Object.fromEntries(
      DIMENSIONS.map((d) => [d, { n: per[d].n, exact: per[d].n === 0 ? null : per[d].same / per[d].n, meanAbsDiff: per[d].n === 0 ? null : per[d].diff / per[d].n }]),
    ) as Agreement['perDimension'],
    overallExact: cells === 0 ? null : same / cells,
  };
}

/** `lanes` maps a rater to the tasks they built. Builders do not score their own lane. */
export function assertNoSelfScoring(ratings: readonly Rating[], key: SampleKey, lanes: Record<string, readonly TaskName[]>): void {
  for (const r of ratings) {
    const task = key[r.blindId]?.task;
    if (task && lanes[r.rater]?.includes(task)) throw new Error(`${r.rater} scored ${r.blindId}, a ${task} item from their own lane`);
  }
}

export function summarizeByArm(
  items: readonly BlindItem[],
  key: SampleKey,
  ratings: readonly Rating[],
): Record<Arm, { n: number; passRate: number | null; meanFraction: number | null }> {
  const out = { harness: { n: 0, pass: 0, frac: 0 }, baseline: { n: 0, pass: 0, frac: 0 } };
  for (const item of items) {
    const rs = ratings.filter((r) => r.blindId === item.blindId);
    if (rs.length === 0) continue;
    const scored = rs.map((r) => itemScore(r.scores, item.multiTurn));
    const arm = key[item.blindId].arm;
    out[arm].n++;
    out[arm].pass += scored.filter((s) => s.pass).length / scored.length;
    out[arm].frac += scored.reduce((a, s) => a + s.total / s.max, 0) / scored.length;
  }
  const fin = (x: { n: number; pass: number; frac: number }) => ({ n: x.n, passRate: x.n === 0 ? null : x.pass / x.n, meanFraction: x.n === 0 ? null : x.frac / x.n });
  return { harness: fin(out.harness), baseline: fin(out.baseline) };
}

const SECTION_ORDER = ['discussed', 'instructions', 'medications', 'next_steps'];

/**
 * The text a rater reads. Structure that only one arm produces (the plan title, the templated "I could not confirm this"
 * lines, `dropped`, ids, key order, markdown) is removed or normalised, so the arm cannot be guessed from layout or length (E-14).
 */
export function renderReplyForRater(task: TaskName, body: unknown): string {
  const o = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const b = o(body);
  const lines: string[] = [];
  if (task === 'plan') {
    const plan = b.plan === undefined ? b : o(b.plan);
    lines.push(`Main concern: ${str(plan.mainConcern)}`);
    const words = arr(plan.symptomsInMyWords).map(str).filter(Boolean);
    if (words.length > 0) lines.push(`In my words: ${words.join('; ')}`);
    for (const it of arr(plan.items)) lines.push(`- ${str(o(it).text)}`);
  } else if (task === 'practice') {
    lines.push(str(b.clinicianSay));
  } else if (task === 'sayit') {
    lines.push(str(b.script));
  } else {
    const items = arr(b.items).map(o);
    const sorted = [...items].sort((x, y) => SECTION_ORDER.indexOf(str(x.section)) - SECTION_ORDER.indexOf(str(y.section)) || str(x.text).localeCompare(str(y.text)));
    for (const it of sorted) lines.push(`${str(it.section)}: ${str(it.text)} (${arr(it.evidence).map(str).sort().join(', ')})`);
    for (const s of [...arr(b.planStatus).map(o)].sort((x, y) => str(x.itemId).localeCompare(str(y.itemId)))) lines.push(`${str(s.itemId)}: ${str(s.status)}`);
  }
  return lines
    .map((l) => l.replace(/[*_#`>]+/g, '').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
