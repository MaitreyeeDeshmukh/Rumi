// /privacy copy (spec section 6.6). The Memory paragraph and the "Open Settings" link are added when /settings exists.
export const PRIVACY = {
  keeps: {
    h2: "What Rumi does with your information.",
    caption: "What Rumi keeps and what it sends",
    rows: [
      { label: "On this device", text: "Your settings, plan, practice, recap, appointments, and chats." },
      {
        label: "If you turn on account sync",
        text: "Your appointments, documents, and chats are also kept in Rumi's own database. Delete them in Settings.",
      },
      {
        label: "Sent when you press a button",
        text: "The text you wrote goes to an AI service to make the answer. Rumi does not store that text.",
      },
      {
        label: "Letters and photos",
        text: "The words or photo go to an AI service to be read. Rumi keeps the words, not the photo.",
      },
      {
        label: "Voice typing",
        text: "Your browser's speech service may send audio to the browser company. Typing never does.",
      },
      { label: "Never", text: "Rumi never sends anything to a clinic or a person." },
    ],
  },
  control: {
    h2: "You are in control.",
    items: [
      "You can edit or remove every line of your plan.",
      "You can delete everything in Settings.",
      "You can delete your cloud copy in Settings.",
      "Rumi does not ask for a diagnosis.",
    ],
  },
} as const;
