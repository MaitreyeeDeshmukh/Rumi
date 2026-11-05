/**
 * Text primitives shared by the guards (harness lane) and the grounding checks (features lane).
 * Pure functions. Whole-token matching only: never use `includes` to decide whether a fact is grounded.
 * No regex lookbehind anywhere: Safari before 16.4 throws a SyntaxError at load on it, and this file is
 * imported by code that ships to the browser. Every scan is linear in the length of the text.
 */
import { STOPWORDS, UNITS, toSet } from '@/features/shared/lists';

const STOP = toSet(STOPWORDS);

/** Digits from scripts NFKC leaves alone (Arabic-Indic, Extended Arabic-Indic, Devanagari) become ASCII. */
const DIGIT_BLOCK_STARTS = [0x0660, 0x06f0, 0x0966] as const;

export function foldDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    for (const start of DIGIT_BLOCK_STARTS) if (cp >= start && cp <= start + 9) return String(cp - start);
    return ch;
  });
}

/** NFKC (fullwidth digits and letters become ASCII) plus digit folding. */
export const normalizeText = (s: string): string => foldDigits(s.normalize('NFKC'));

// A private-use character stands in for the dot of an abbreviation while sentences are split.
const DOT = '';
const ABBREVIATION = /\b(dr|mr|mrs|ms|st|prof|vs|etc|e\.g|i\.e)\./gi;

/** Splits on . ! ? and newlines, keeping "Dr. Lee" and "e.g." together. */
export function splitSentences(text: string): string[] {
  const protectedText = normalizeText(text).replace(ABBREVIATION, (m) => m.slice(0, -1) + DOT);
  const out: string[] = [];
  for (const line of protectedText.split(/\n+/)) {
    let start = 0;
    const boundary = /[.!?]+\s+/g;
    for (let m = boundary.exec(line); m; m = boundary.exec(line)) {
      const terminators = (/^[.!?]+/.exec(m[0]) ?? [''])[0].length;
      out.push(line.slice(start, m.index + terminators));
      start = m.index + m[0].length;
    }
    out.push(line.slice(start));
  }
  return out.map((s) => s.split(DOT).join('.').trim()).filter(Boolean);
}

export interface Amount {
  /** Number as written, thousands commas removed. */
  value: string;
  /** Lowercase unit, from the UNITS list. */
  unit: string;
}

const canonNumber = (n: string): string => n.replace(/,(?=\d{3}(?:\D|$))/g, '');
const escapeRe = (u: string): string => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UNIT_ALT = [...UNITS].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
const NUMBER = String.raw`\d+(?:[.,]\d+)*`;
const NUMBER_RE = new RegExp(NUMBER, 'g');
// Anchored at the end of a number that NUMBER_RE already found, so the total work stays linear in the text length.
const UNIT_AFTER_RE = new RegExp(String.raw`^\s{0,8}(${UNIT_ALT})(?![\p{L}\d])`, 'iu');

/** Every number token in the text (`500mg` gives `500`, `1,000` gives `1000`, `2.5` stays `2.5`). */
export function numberTokens(text: string): string[] {
  return (normalizeText(text).match(NUMBER_RE) ?? []).map(canonNumber);
}

/** Number plus known unit, glued or spaced: `500mg`, `500 mg`, `5pm`, `3rd`, `20mins`, `3x`, `2 weeks`. Linear time. */
export function extractAmounts(text: string): Amount[] {
  const t = normalizeText(text);
  const out: Amount[] = [];
  for (const m of t.matchAll(NUMBER_RE)) {
    const from = (m.index ?? 0) + m[0].length;
    const unit = UNIT_AFTER_RE.exec(t.slice(from, from + 24));
    if (unit) out.push({ value: canonNumber(m[0]), unit: unit[1].toLowerCase() });
  }
  return out;
}

export const amountKey = (a: Amount): string => `${a.value}|${a.unit}`;

/** Lowercase letter-only tokens. Accents are kept. */
export function wordList(text: string): string[] {
  return normalizeText(text).toLowerCase().match(/\p{L}+/gu) ?? [];
}

export const wordSet = (text: string): Set<string> => new Set(wordList(text));

/** Words of three or more letters that are not stopwords. */
export function contentWords(text: string): string[] {
  return wordList(text).filter((w) => w.length >= 3 && !STOP.has(w));
}

/** True when the two texts share at least one content word. Lenient on purpose: it only answers "same topic". */
export function sharesContentWord(a: string, b: string): boolean {
  const wb = new Set(contentWords(b));
  return contentWords(a).some((w) => wb.has(w));
}

/** Whole-token containment: is every token of `needle` present as a token of `haystack`? Never a substring test. */
export function containsAllTokens(haystack: string, needle: string): boolean {
  const have = wordSet(haystack);
  const need = wordList(needle);
  return need.length > 0 && need.every((w) => have.has(w));
}
