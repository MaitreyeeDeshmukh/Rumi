import { contentWords, wordList } from "@/lib/text/tokens";

/** Irregular forms that the suffix rules would miss: written/wrote/writing/write all end up as "writ". */
const IRREGULAR: Record<string, string> = { written: "writ", wrote: "writ", began: "begin", begun: "begin" };

/**
 * A crude stem so plural and tense forms count as the same word: headaches/headache, needed/need, writing/write.
 * It only ever answers "same topic"; it is never used to compare numbers, doses or names.
 */
export function stem(word: string): string {
  let s = word.toLowerCase();
  if (s in IRREGULAR) return IRREGULAR[s];
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s.length > 3 && s.endsWith("e") ? s.slice(0, -1) : s;
}

/**
 * Words that mean the same in a visit, by stem: when a text says the key, it also counts as saying the values.
 * Keys are stems (come is "com", schedule is "schedul"). One direction per entry, written both ways where both are true. No entry turns a word into its opposite or adds or
 * removes a negation (that is checked separately), so a map can only make a faithful paraphrase easier to accept.
 */
const SAME_AS: Record<string, readonly string[]> = {
  head: ["headach"],
  headach: ["head"],
  now: ["next"],
  com: ["return"],
  return: ["com"],
  mak: ["schedul", "book"],
  book: ["schedul"],
  schedul: ["mak", "book"],
  improv: ["better"],
  better: ["improv"],
  medicin: ["medication"],
  medication: ["medicin"],
};

/** Distinct stems of the content words (three letters or more, no stopwords) of a text. */
export const contentStems = (text: string): string[] => [...new Set(contentWords(text).map(stem))];

/** Stems of EVERY word, stopwords included, plus the stems that mean the same: what a text actually says. */
export function allStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of wordList(text)) {
    const s = stem(w);
    out.add(s);
    for (const same of SAME_AS[s] ?? []) out.add(same);
  }
  return out;
}
