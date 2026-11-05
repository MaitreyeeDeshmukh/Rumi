/**
 * `pnpm eval --human-sheet=S --human-key=K --human-ratings=R [--human-lanes=L]`: the 20-output human read.
 * R is a JSON array of ratings, each {blindId, rater, scores:{truth,safety,intent,literal,agency,continuity?}}, from exactly
 * two raters. L (optional) maps a rater to the tasks they built, e.g. {"aakash": ["plan","practice"]}: builders do not score
 * their own lane. Prints the rubric table, agreement and per-arm means; any invalid rating fails the run.
 */
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { renderHumanRead } from './scorers/report';
import type { BlindItem, Rating, SampleKey } from './scorers/humanSample';
import type { TaskName } from './types';

const read = <T>(envName: string): T => JSON.parse(readFileSync(process.env[envName] as string, 'utf8')) as T;

it('human read', () => {
  const sheet = read<BlindItem[]>('EVAL_HUMAN_SHEET');
  const key = read<SampleKey>('EVAL_HUMAN_KEY');
  const ratings = read<Rating[]>('EVAL_HUMAN_RATINGS');
  const lanes = process.env.EVAL_HUMAN_LANES ? read<Record<string, TaskName[]>>('EVAL_HUMAN_LANES') : {};
  process.stdout.write(`${renderHumanRead(sheet, key, ratings, lanes).join('\n')}\n`);
});
