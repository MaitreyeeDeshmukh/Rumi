// Home page copy (spec section 6.1) and the made-up lines shown in the static previews.
// tests/unit/copy.test.ts lints every string here.
export const HOME = {
  hero: {
    secondary: "See how it works",
    fine: "Rumi is an AI helper. It is not a doctor. This is a student project. All examples are made up.",
  },
  problem: {
    h2: "A visit is short. The questions are fast.",
    text: "A doctor visit is often short. The doctor asks questions quickly. Many people freeze. A parent or helper often answers instead. Then you leave without knowing what was decided.",
  },
  audience: {
    h2: "Made for autistic and ADHD adults.",
    text: "You may live at home, on campus, or in supported housing. Someone may usually speak for you at the doctor. Rumi helps you do it yourself. You do not need a diagnosis. Rumi never asks for one.",
  },
  steps: {
    h2: "Three steps.",
    items: [
      {
        title: "Get ready",
        text: "Write what is going on, in your own words. Rumi turns it into a short plan. You can change every line.",
      },
      {
        title: "Practice",
        text: "Talk with a pretend clinician. Ask for help when you are stuck. You get less help as you need less.",
      },
      {
        title: "Remember",
        text: "See what was said at a visit. Every point shows the lines it came from. Rumi tells you when it could not confirm something.",
      },
    ],
    details: "Read the details",
  },
  different: {
    h2: "Four things Rumi does.",
    items: [
      { title: "One plan, used three times.", text: "The same plan guides your practice and checks your recap." },
      { title: "Proof for every point.", text: "Each summary point links to the exact lines it came from." },
      { title: "What I said myself.", text: "See which questions you asked, and which someone else asked." },
      { title: "Plain language, always.", text: "Short sentences. No idioms. Rumi checks its own words." },
    ],
  },
  control: {
    h2: "You stay in control.",
    items: [
      "Rumi never sends anything for you. You copy or share it.",
      "You can edit or remove every line.",
      "Your plan is saved on your device. It goes to the AI service only when you press a button.",
      "You can delete everything in Settings.",
      "Rumi is built not to give medical advice.",
    ],
    link: "How we handle your data",
  },
  safety: {
    label: "If you are in danger",
    text: "If you are in danger, call or text 988 (US) or call 911. Rumi is not an emergency service.",
  },
  faq: {
    h2: "Questions people ask.",
  },
  final: {
    h2: "Ready to try it?",
    contact: "Contact us",
  },
  // Made-up lines for the phone frame in the hero (not the real Get ready screen).
  preview: {
    title: "Your plan",
    caption: "Example plan. Made up.",
    cards: [
      { label: "What is going on", text: "I have had headaches for two weeks.", tag: "You said this" },
      { label: "What I want to ask", text: "Could my sleep be part of the cause?", tag: "You said this" },
      { label: "How to support me", text: "Please speak slowly and ask one thing at a time.", tag: "Suggested" },
    ],
  },
} as const;

export const EXAMPLE_CAPTION = "Made up";

// Hand-written labels and image text for the illustrated home page. The drawings are decorative,
// so most images use empty alt text; the hero drawing is described once.
export const HOME_ART = {
  heroAlt: "A drawing of a person who sits in a chair with a book and waits.",
  kicker: {
    hero: "for your next doctor visit",
    problem: "why visits are hard",
    audience: "who Rumi is for",
    steps: "how it works",
    different: "what is different",
    control: "your data",
    faq: "more answers",
    final: "start when you want",
  },
  credit: "Drawings by Pablo Stanley, from Open Doodles and Open Peeps (CC0).",
} as const;
