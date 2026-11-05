/**
 * Invented numbers and units, written from scratch for the eval (it shares no code with the harness checks).
 * A quantity in the reply is grounded only if the input has the same value with the same unit, or, for a bare number,
 * the same value with any unit.
 */
import { prose } from './body';

export interface Quantity {
  value: number;
  unit: string;
  raw: string;
}

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  dozen: 12, half: 0.5, twice: 2, thrice: 3,
};

const UNIT_CANON: Record<string, string> = {
  mg: 'mg', mcg: 'mcg', 'µg': 'mcg', ug: 'mcg', g: 'g', kg: 'kg', ml: 'ml', l: 'l', iu: 'iu', unit: 'unit', units: 'unit',
  tablet: 'pill', tablets: 'pill', tab: 'pill', tabs: 'pill', pill: 'pill', pills: 'pill',
  capsule: 'capsule', capsules: 'capsule', cap: 'capsule', caps: 'capsule',
  drop: 'drop', drops: 'drop', puff: 'puff', puffs: 'puff', spray: 'spray', sprays: 'spray',
  percent: '%', '%': '%',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min',
  h: 'hour', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour',
  day: 'day', days: 'day', wk: 'week', wks: 'week', week: 'week', weeks: 'week',
  mo: 'month', mos: 'month', month: 'month', months: 'month', yr: 'year', yrs: 'year', year: 'year', years: 'year',
  time: 'time', times: 'time', x: 'time', am: 'am', pm: 'pm', st: 'ord', nd: 'ord', rd: 'ord', th: 'ord',
  oz: 'oz', cup: 'cup', cups: 'cup', glass: 'glass', glasses: 'glass', spoon: 'spoon', spoons: 'spoon',
  teaspoon: 'spoon', teaspoons: 'spoon', tablespoon: 'spoon', tablespoons: 'spoon',
};
const UNIT_ALT = Object.keys(UNIT_CANON)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

/** Zero code points of the digit blocks NFKC does not fold: Arabic-Indic, Persian, Devanagari, Bengali, Gurmukhi, Gujarati. */
const DIGIT_BASES = [0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6];

function fold(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Nd}/gu, (ch) => {
      const cp = ch.codePointAt(0) as number;
      const base = DIGIT_BASES.find((b) => cp >= b && cp <= b + 9);
      return base === undefined ? ch : String(cp - base);
    })
    .toLowerCase();
}

const DIGITS_RE = new RegExp(`(?<![a-z0-9_])(\\d+(?:[.,]\\d+)?)\\s?(${UNIT_ALT})?(?![a-z0-9])`, 'g');
const WORDS_RE = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b(?:\\s+(${UNIT_ALT})\\b)?`, 'g');
const REL_RE = /\b(yesterday|last (?:night|week|month|year)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b/g;
const HALF_UNIT_RE = /^(?:an? )?(hour|day|week|month|year)\b/;

const unitOf = (raw: string | undefined): string => (raw === undefined ? '' : (UNIT_CANON[raw] ?? ''));

export function extractQuantities(input: string): Quantity[] {
  const text = fold(input).replace(/\b1 to 10\b/g, ' ');
  const found: { at: number; q: Quantity }[] = [];
  for (const m of text.matchAll(DIGITS_RE)) {
    found.push({ at: m.index, q: { value: Number(m[1].replace(',', '.')), unit: unitOf(m[2]), raw: m[0].trim() } });
  }
  for (const m of text.matchAll(WORDS_RE)) {
    const word = m[1];
    let unit = unitOf(m[2]);
    // `one` is a pronoun unless a unit follows.
    if (word === 'one' && unit === '') continue;
    if (word === 'twice' || word === 'thrice') unit = 'time';
    if (word === 'half') {
      const hm = text.slice(m.index + word.length).trimStart().match(HALF_UNIT_RE);
      if (!hm) continue;
      unit = unitOf(hm[1]);
    }
    found.push({ at: m.index, q: { value: WORDS[word], unit, raw: m[0].trim() } });
  }
  // `once` is only a quantity as a frequency: "once a day", not "once you are ready".
  for (const m of text.matchAll(/\bonce\b(?=\s+(?:a|per|every|each|daily)\b)/g)) {
    found.push({ at: m.index, q: { value: 1, unit: 'time', raw: 'once' } });
  }
  for (const m of text.matchAll(REL_RE)) {
    found.push({ at: m.index, q: { value: Number.NaN, unit: `rel:${m[1]}`, raw: m[1] } });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.q);
}

const keyOf = (q: Quantity): string => (Number.isNaN(q.value) ? q.unit : `${q.value}:${q.unit}`);

export interface NumbersVerdict {
  ok: boolean;
  empty: boolean;
  invented: string[];
}

function grounded(q: Quantity, ground: readonly Quantity[]): boolean {
  if (ground.some((g) => keyOf(g) === keyOf(q))) return true;
  if (q.unit === '' && !Number.isNaN(q.value)) return ground.some((g) => g.value === q.value);
  return false;
}

export function scoreNumbers(body: unknown, groundTexts: readonly string[], skipKeys: readonly string[] = []): NumbersVerdict {
  const texts = prose(body, skipKeys).filter((t) => t.trim().length > 0);
  if (texts.length === 0) return { ok: false, empty: true, invented: [] };
  const ground = groundTexts.flatMap(extractQuantities);
  const invented: string[] = [];
  for (const t of texts) {
    for (const q of extractQuantities(t)) {
      if (!grounded(q, ground)) invented.push(q.unit && !q.unit.startsWith('rel:') ? `${q.value} ${q.unit}` : q.raw);
    }
  }
  return { ok: invented.length === 0, empty: false, invented };
}
