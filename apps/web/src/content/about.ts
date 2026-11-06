// /about copy (spec section 6.3). "Who we are" shows only when src/lib/team.ts holds real names.
export const ABOUT = {
  why: {
    h2: "Why Rumi exists",
    text: "A doctor visit is often short. The doctor asks questions quickly. Many people freeze. Rumi helps you speak for yourself.",
  },
  who: {
    h2: "Who we are",
    text: "We are a student team.",
  },
  tested: {
    h2: "What we have tested",
    text: "We have had one conversation with a partner organization that supports autistic adults. We have not yet tested Rumi with residents or patients.",
  },
  ai: {
    h2: "How Rumi uses AI",
    text: "Rumi uses an AI service to write plans, play a practice clinician, and write summaries. Checks run before and after the AI. When Rumi spots crisis words, it shows help. It does not send those words to the AI. If the AI is down, Rumi uses simple built-in help.",
    link: "Read about safety",
  },
  contact: {
    h2: "Contact",
    text: "Questions or feedback? Write to us.",
    link: "Contact us",
  },
} as const;
