/**
 * The words on the privacy page, kept apart from the page so a test can check every sentence.
 * Each line says something that is true of the app as built. If the app changes, change the line.
 * Every sentence has at most 15 words (tests/unit/privacyCopy.test.ts).
 */
export interface PrivacySection {
  heading: string;
  lines: readonly string[];
}

export const PRIVACY_INTRO = "Plain answers about your information.";

export const PRIVACY_SECTIONS: readonly PrivacySection[] = [
  {
    heading: "What stays on your device",
    lines: [
      "Rumi keeps your choices and your notes in your own browser, on your own device.",
      "Rumi sends nothing unless you use the AI helper or turn on memory.",
    ],
  },
  {
    heading: "When you use the AI helper",
    lines: [
      "The words you type are sent to the company that runs the AI.",
      "It uses them to write the reply.",
      "Rumi does not save those words in its database or in its logs.",
    ],
  },
  {
    heading: "If you turn on memory",
    lines: [
      "Memory is off until you turn it on.",
      "If you turn it on, Rumi saves an anonymous account id.",
      "It also saves the id of each choice you made.",
      "These are saved in Rumi’s own database, not with another company.",
      "Rumi does not save your name or your health details.",
      "It does not save what you write in your plan.",
      "You can delete everything at any time.",
    ],
  },
  {
    heading: "How to clear it",
    lines: ["In the preview, open You, then Your data, then Clear all demo data.", "Clearing your browser data also removes it."],
  },
  {
    heading: "Please use sample information",
    lines: ["Please do not type real health details or your name."],
  },
];
