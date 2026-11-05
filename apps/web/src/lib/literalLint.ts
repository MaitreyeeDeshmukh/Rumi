export type LintReason = 'too_long' | 'idiom' | 'double_command';
export interface LintFailure { sentence: string; reason: LintReason }
export const MAX_WORDS = 15;

// Starter list from spec 9.6 + extras. Teammates add more from Josh's notes and testers by PR to this one array.
export const IDIOMS = ['run through', 'a bit', 'sort of', 'kind of', 'touch base', 'keep an eye', 'piece of cake', 'under the weather',
  'heads up', 'hang in there', 'figure out', 'in a nutshell', 'on the same page', 'a lot on your plate', 'bear with me',
  'hit the ground running', 'bite the bullet', 'break the ice', 'call it a day', 'cut corners', 'keep in mind',
  'at the end of the day', 'give it a shot', 'get the ball rolling', 'back to square one', 'think outside the box',
  'rule of thumb', 'play it by ear', 'take it easy', 'no big deal', 'pretty much', 'a couple of'];

const IMPERATIVES = ['open', 'close', 'take', 'put', 'write', 'tell', 'ask', 'bring', 'call', 'go', 'sit', 'stand', 'wait', 'read', 'say',
  'pick', 'choose', 'tap', 'press', 'drink', 'eat', 'lie', 'keep', 'come', 'give', 'show', 'follow', 'check', 'sign', 'fill', 'turn', 'move', 'walk'];
const DOUBLE = new RegExp(`^(please\\s+)?(${IMPERATIVES.join('|')})\\b[^.!?]*\\band\\s+(please\\s+)?(${IMPERATIVES.join('|')})\\b`, 'i');

export const splitSentences = (t: string): string[] => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export function literalLint(text: string): { ok: boolean; failures: LintFailure[] } {
  const failures: LintFailure[] = [];
  for (const sentence of splitSentences(text)) {
    const lower = sentence.toLowerCase();
    if (sentence.split(/\s+/).length > MAX_WORDS) failures.push({ sentence, reason: 'too_long' });
    else if (IDIOMS.some((p) => new RegExp('\\b' + p.replace(/ /g, '\\s+') + '\\b', 'i').test(lower))) failures.push({ sentence, reason: 'idiom' });
    else if (DOUBLE.test(sentence)) failures.push({ sentence, reason: 'double_command' });
  }
  return { ok: failures.length === 0, failures };
}

export const lintGuard = (texts: string[]): string[] => texts.flatMap((text) => literalLint(text).failures.map((f) => `lint:${f.reason}`));
