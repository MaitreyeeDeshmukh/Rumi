/**
 * The eval's own literal-language check for `lintPassFirstTry`: no sentence over 15 words and no idiom from a short list.
 * It is a report metric (not a gate) and shares nothing with the product lint.
 */
import { prose } from './body';

const IDIOMS = [
  'under the weather', 'a piece of cake', 'break the ice', 'hit the sack', 'in the same boat', 'on the ball', 'beat around the bush',
  'cost an arm and a leg', 'bite the bullet', 'spill the beans', 'out of the blue', 'rule of thumb', 'ballpark', 'touch base',
  'on the fence', 'play it by ear', 'back to square one', 'the ball is in your court', 'let the cat out of the bag', 'raining cats and dogs',
];
const IDIOM_RE = new RegExp(`\\b(?:${IDIOMS.join('|')})\\b`, 'i');

const MAX_WORDS = 15;

function sentencesOf(text: string): string[] {
  const guarded = text.replace(/\b(dr|mr|mrs|ms|st|e\.g|i\.e)\./gi, (m) => m.replace('.', '\u0001'));
  return guarded
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\u0001/g, '.').trim())
    .filter(Boolean);
}

/** True when the reply has prose and every sentence is short and idiom-free. Empty prose is not clean. */
export function literalClean(body: unknown, skipKeys: readonly string[] = ['unconfirmed']): boolean {
  const texts = prose(body, skipKeys).filter((t) => t.trim().length > 0);
  if (texts.length === 0) return false;
  return texts.every((t) => !IDIOM_RE.test(t) && sentencesOf(t).every((s) => s.split(/\s+/).length <= MAX_WORDS));
}
