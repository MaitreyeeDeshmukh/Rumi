// /accessibility copy (spec section 6.6).
export const ACCESSIBILITY = {
  supports: {
    h2: "What Rumi supports.",
    items: [
      "Three looks: Soft Focus, High Contrast, and Low Light.",
      "Text size up to 150 percent.",
      "A reduce motion setting. Rumi also follows your device setting.",
      "Keyboard use on every page.",
      "Headings, labels, and live updates for screen readers.",
      "Buttons at least 44 pixels tall.",
    ],
  },
  gaps: {
    h2: "Known gaps.",
    items: [
      "We have used a keyboard and automatic checks. We have not yet tested with many screen reader users.",
      "Voice typing depends on your browser.",
      "The app part of Rumi needs JavaScript.",
    ],
  },
  report: {
    h2: "Tell us about a problem.",
    text: "Use the Contact page. Say which page and which device.",
  },
} as const;
