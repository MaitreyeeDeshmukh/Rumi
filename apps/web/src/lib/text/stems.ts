import { contentWords, wordList } from "@/lib/text/tokens";

/** Irregular forms that the suffix rules would miss: written/wrote/writing/write all end up as "writ". */
const IRREGULAR: Record<string, string> = { written: "writ", wrote: "writ", began: "begin", begun: "begin" };

/**
 * A crude stem so plural and tense forms count as the same word: headaches/headache, needed/need, writing/write.
 * It only ever answers "same topic"; it is never used to compare numbers, doses or names.
 */
/** forgetting and stopped lose their doubled letter once the ending is off: forgett to forget, stopp to stop (not call, miss, buzz). */
const undouble = (s: string): string => (s.length > 3 && /([^aeiouyls])\1$/.test(s) ? s.slice(0, -1) : s);

/** After an ending is off, the stem gets the same plural rule as a plain word, so focusing and focus end up as the same stem. */
const tidy = (s: string): string => {
  const u = undouble(s);
  return u.length > 3 && u.endsWith("s") && !u.endsWith("ss") ? u.slice(0, -1) : u;
};

export function stem(word: string): string {
  let s = word.toLowerCase();
  if (s in IRREGULAR) return IRREGULAR[s];
  if (s.length > 5 && s.endsWith("ing")) s = tidy(s.slice(0, -3));
  else if (s.length > 4 && s.endsWith("ed")) s = tidy(s.slice(0, -2));
  else if (s.length > 4 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s.length > 3 && s.endsWith("e") ? s.slice(0, -1) : s;
}

/**
 * Words that mean the same in a visit, by stem: when a text says the key, it also counts as saying the values.
 * Keys are stems (come is "com", schedule is "schedul"). One direction per entry, written both ways where both are true. No entry turns a word into its opposite or adds or
 * removes a negation (that is checked separately), so a map can only make a faithful paraphrase easier to accept.
 */
const PAIRS: Record<string, readonly string[]> = {
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

/**
 * Groups of words that name the same thing in a health talk. Any word of a group counts as saying the others. They are
 * written as words and turned into stems here. None joins a word to its opposite, and none changes a negation.
 */
const GROUPS: readonly (readonly string[])[] = [
  ["pain", "painful", "hurt", "ache", "sore"],
  ["tooth", "teeth"],
  ["shake", "shaky", "shaking", "tremble", "trembling"],
  ["tummy", "stomach", "belly"],
  ["vomit", "throw"],
  ["tired", "exhausted", "fatigue", "tiredness", "drained"],
  ["angry", "anger", "furious"],
  ["swollen", "swelling", "swelled", "swell"],
  ["dizzy", "dizziness"],
  ["sleep", "slept", "sleeping", "sleepy"],
  ["nervous", "anxious", "worried", "anxiety", "worry"],
  ["nauseous", "nausea", "sick"],
  ["itchy", "itch", "itches"],
  ["breathless", "breath", "breathing"],
  ["cough", "coughing", "coughs"],
  ["sad", "sadness", "unhappy"],
  ["scared", "afraid", "frightened", "fear"],
  ["rash", "spots"],
  ["forget", "forgetful", "memory"],
  ["focus", "concentrate", "attention"],
];

const SAME_AS: Record<string, readonly string[]> = (() => {
  const out: Record<string, string[]> = Object.fromEntries(Object.entries(PAIRS).map(([k, v]) => [k, [...v]]));
  for (const group of GROUPS) {
    const stems = group.map((w) => stem(w));
    for (const s of stems) out[s] = [...new Set([...(out[s] ?? []), ...stems.filter((x) => x !== s)])];
  }
  return out;
})();

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
