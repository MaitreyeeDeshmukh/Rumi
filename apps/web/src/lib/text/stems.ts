import { contentWords, wordList } from "@/lib/text/tokens";

/**
 * A crude stem so plural and tense forms count as the same word: headaches/headache, needed/need, writing/write.
 * It only ever answers "same topic"; it is never used to compare numbers, doses or names.
 */
export function stem(word: string): string {
  let s = word.toLowerCase();
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s.length > 3 && s.endsWith("e") ? s.slice(0, -1) : s;
}

/** Distinct stems of the content words (three letters or more, no stopwords) of a text. */
export const contentStems = (text: string): string[] => [...new Set(contentWords(text).map(stem))];

/** Stems of EVERY word, stopwords included: what a line actually says, to check an item's content words against. */
export const allStems = (text: string): Set<string> => new Set(wordList(text).map(stem));
