/** A limited heuristic, NOT proof that a sentence is factual. Clinical use needs user review. */
export function newFacts(script: string, factsText: string): string[] {
  const allowed = new Set(factsText.toLowerCase().match(/[\p{L}\p{N}]+(?:\.\d+)?/gu) ?? []);
  const out: string[] = [];
  for (const sentence of script.replace(/\[[^\]]*\]/g, '').split(/(?<=[.!?])\s+/)) {
    for (const match of sentence.matchAll(/\b\d+(?:\.\d+)?\b|\b[A-Z][a-z]+\b/g)) {
      const token = match[0];
      if (allowed.has(token.toLowerCase())) continue;
      if (!/^\d/.test(token) && match.index === sentence.search(/\S/) && !['Dr', 'Doctor'].includes(token)) continue;
      out.push(token);
    }
  }
  return [...new Set(out)];
}
export const blanksFrom = (script: string): string[] => [...script.matchAll(/\[([^\]]{1,60})\]/g)].map((m) => m[1]);
