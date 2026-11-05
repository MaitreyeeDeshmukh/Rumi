/** Shorten to at most `max` UTF-16 units at a word boundary when one is near the end; whitespace is collapsed. Never leaves half a surrogate pair. */
export function truncateAtWord(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, Math.max(0, max));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(" ");
  return (space > cut.length / 2 ? cut.slice(0, space) : cut).trimEnd();
}
