/** The six preset support statements. Only their ids ever sync; this table is the one place the text lives. */
export const SUPPORT_PRESETS = [
  { id: 'p1', text: 'Please speak slowly.' },
  { id: 'p2', text: 'Please ask me one question at a time.' },
  { id: 'p3', text: 'Please write down instructions for me.' },
  { id: 'p4', text: 'Please tell me what will happen before it happens.' },
  { id: 'p5', text: 'I may need extra time to answer.' },
  { id: 'p6', text: 'Please tell me before you touch me.' },
] as const;

export const MAX_CUSTOM_WORDS = 15;

const BY_ID: ReadonlyMap<string, string> = new Map(SUPPORT_PRESETS.map((p) => [p.id, p.text]));

/** Map lookup, so 'constructor' and '__proto__' are just unknown ids. */
export const presetText = (id: string): string | undefined => BY_ID.get(id);
