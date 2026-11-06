// swap when the lane merges (src/lib/crisis.ts)
const PATTERNS: RegExp[] = [
  /\b(hurt|harm|kill)(ing)?\s+(myself|me)\b/i,
  /\bsuicid\w*/i,
  /\bend(ing)?\s+(it all|my life|everything)\b/i,
  /\bwant(ed)?\s+to\s+(die|disappear)\b/i,
  /\b(don'?t|do not)\s+want\s+to\s+(be here|live|exist|be alive)\b/i,
  /\bself[- ]?harm\w*/i,
  /\b(can'?t|cannot)\s+(go on|breathe)\b/i,
  /\bchest pain\b/i,
  /\boverdos(e|ed|ing)\b/i,
];

export function isCrisis(text: string): boolean {
  const t = text.normalize("NFKC").replace(/[‘’]/g, "'");
  return PATTERNS.some((p) => p.test(t));
}
