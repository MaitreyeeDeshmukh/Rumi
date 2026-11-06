// /say-it copy (spec 4.8, plan 04). tests/unit/copy.test.ts lints every string.
export const SAYIT = {
  listTitle: "What do you need to say?",
  scenarios: [
    { id: "book", label: "Book an appointment" },
    { id: "late", label: "I am running late" },
    { id: "repeat", label: "Ask them to repeat" },
    { id: "written", label: "Ask for written instructions" },
    { id: "next", label: "Ask what to do next" },
  ],
  writing: "Writing your script.",
  scriptLabel: "Your script",
  scriptHint: "You can change the words. Replace anything in [brackets].",
  readAloud: "Read aloud",
  stopReading: "Stop reading",
  reading: "Reading the script. Press Escape to stop.",
  copy: "Copy",
  copied: "Copied.",
  copyFailed: "Copy is not available here. The text is selected so you can copy it.",
  simpler: "Make it simpler",
  another: "Pick another",
  tryAgain: "Try again",
  error: "I could not write this. Try again.",
  note: "Rumi does not call anyone. You say it yourself.",
  // Used by the callApi shim until the AI lane answers /api/sayit. Index 0 is level 2, index 1 is level 3.
  shim: {
    book: [
      ["Hello. I would like to book an appointment. Do you have time on [day]?", ["day"]],
      ["Hello. I want to book an appointment.", []],
    ],
    late: [
      ["Hello. I am running late for my visit. I will be there in about [number] minutes.", ["number"]],
      ["Hello. I am late. I will be there soon.", []],
    ],
    repeat: [
      ["Sorry, I did not catch that. Could you say it again, more slowly?", []],
      ["Please say that again, slowly.", []],
    ],
    written: [
      ["Could you please write those instructions down for me? I remember better when I can read them.", []],
      ["Please write that down for me.", []],
    ],
    next: [
      ["What should I do next? Please tell me the first step, and when I should come back.", []],
      ["What do I do next?", []],
    ],
  },
} as const;
