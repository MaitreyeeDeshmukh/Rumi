// /safety copy (spec section 6.6). The three call buttons use the labels in src/content/crisis.ts.
export const SAFETY = {
  danger: {
    h2: "If you are in danger.",
    text: "Call or text 988 (US) now. For an emergency, call 911. Rumi is not an emergency service.",
  },
  does: {
    h2: "What Rumi does.",
    items: [
      "Rumi shows you this help when it spots crisis words.",
      "When it spots crisis words, it does not send them to the AI.",
      "Rumi says clearly that it is an AI helper.",
      "Rumi asks you before anything is shared.",
    ],
  },
  doesNot: {
    h2: "What Rumi does not do.",
    items: [
      "Rumi does not give medical advice.",
      "Rumi does not name conditions or suggest medicine.",
      "Rumi does not call anyone for you.",
      "Rumi does not send anything to a clinic or a person.",
    ],
  },
  unsure: {
    h2: "If you are not sure.",
    text: "Ask your clinician. Ask someone you trust. To report a problem with Rumi, use Contact.",
    link: "Contact us",
  },
} as const;
