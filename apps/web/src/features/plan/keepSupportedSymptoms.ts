const normalized = (s: string): string => s.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
/** Exact phrase containment is conservative: do not treat one shared word as evidence. */
export const isVerbatim = (candidate: string, source: string): boolean => {
  const a = normalized(candidate); const b = normalized(source);
  if (!a) return false;
  const index = (` ${b} `).indexOf(` ${a} `);
  if (index < 0) return false;
  const preceding = b.slice(0, index).trim().split(' ').slice(-4).join(' ');
  if (/\b(no|not|without|never|denies)\b/.test(preceding) && !/\b(no|not|without|never|denies)\b/.test(a)) return false;
  return true;
};
/** Kept as a compatibility helper; NOT a factual-verification guarantee. */
export const sharesWord = (a: string, b: string): boolean => {
  const words = new Set(normalized(b).split(' '));
  return normalized(a).split(' ').some((w) => w.length >= 3 && words.has(w));
};
export const keepSupportedSymptoms = (raw: string, symptoms: string[]): string[] =>
  [...new Set(symptoms.filter((s) => isVerbatim(s, raw)))];
