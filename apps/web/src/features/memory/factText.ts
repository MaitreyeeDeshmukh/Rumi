/**
 * The ONLY place a persona sentence is made. A fact carries (kind, key, level) and no free text, so the sentence
 * is derived from fixed tables. Nothing a person typed can reach a prompt or a stored line through here.
 * Every sentence has at most 15 words and no digits (a test enumerates all of them).
 */
import { presetText } from '@/features/support/presets';

const PACING_PRESET: ReadonlyMap<string, string> = new Map([
  ['one_question', 'p2'],
  ['extra_time', 'p5'],
]);
const KIND_WORD: ReadonlyMap<string, string> = new Map([
  ['concern', 'explaining my problem'],
  ['question', 'asking my questions'],
  ['accommodation', 'asking for support'],
]);
const LEVEL_WORD: ReadonlyMap<number, string> = new Map([
  [0, 'no help'],
  [1, 'a hint'],
  [2, 'a sentence with blanks'],
  [3, 'a full sentence'],
]);

/** Returns null for anything that is not a known (kind, key, level). All arguments are untrusted. */
export function factText(kind: string, key: string, level?: number): string | null {
  if (kind === 'support_pref') return level === undefined ? (presetText(key) ?? null) : null;
  if (kind === 'pacing') {
    const preset = PACING_PRESET.get(key);
    return level === undefined && preset ? (presetText(preset) ?? null) : null;
  }
  if (kind === 'help_level') {
    const what = KIND_WORD.get(key);
    const how = level === undefined ? undefined : LEVEL_WORD.get(level);
    return what && how ? `When I practice ${what}, I needed ${how} last time.` : null;
  }
  return null;
}

/** Sentences for a list of facts, in order, without duplicates (support_pref:p2 and pacing:one_question are one sentence). */
export function factStrings(facts: readonly { kind: string; key: string; level?: number }[]): string[] {
  const out = new Set<string>();
  for (const f of facts) {
    const t = factText(f.kind, f.key, f.level);
    if (t) out.add(t);
  }
  return [...out];
}
