// The help questions (spec section 6.5). /help shows all seven; the home page shows the five in HOME_FAQ_QUESTIONS.
// Each answer is under 60 words. The Memory entry stays only if Settings ships with Memory.
export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "Is Rumi a doctor?",
    a: "No. Rumi is an AI helper. It does not give medical advice, name conditions, or suggest medicine. Ask your clinician about your health.",
  },
  {
    q: "What does Rumi save about me?",
    a: "On your device: your settings, plan, practice, and recap. When you press a button, the text you wrote goes to an AI service. It makes the answer. Rumi does not save that text on its servers.",
  },
  {
    q: "Does Rumi remember me next time?",
    a: 'Only if you turn on Memory in Settings. Rumi then saves short support sentences you chose. It does not save health details or your name. You can delete them any time. Example: "Please speak slowly."',
  },
  {
    q: "Can I use my voice?",
    a: "If your browser supports it, yes. Voice typing may send audio to your browser company. Typing never does. Everything voice can do, typing can do too.",
  },
  {
    q: "Does Rumi contact my clinic?",
    a: "No. Rumi never sends anything to a clinic or a person. You decide what to copy or share.",
  },
  {
    q: "What if the AI is not working?",
    a: "Rumi says so. Then it uses simple built-in help, and your text is kept. You can still make a plan by hand.",
  },
  {
    q: "What if I am in danger?",
    a: "Call or text 988 (US) or call 911 now. Rumi is not an emergency service.",
  },
];

export const HOME_FAQ_QUESTIONS: readonly string[] = [
  "Is Rumi a doctor?",
  "What does Rumi save about me?",
  "Can I use my voice?",
  "Does Rumi contact my clinic?",
  "What if I am in danger?",
];

export const FAQ_COPY = {
  allHelp: "See all help",
} as const;
