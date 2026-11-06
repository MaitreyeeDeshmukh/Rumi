// /get-ready, the support card and the kit text builders (plan 04 step 4). tests/unit/copy.test.ts lints every string.
export const GET_READY = {
  boxLabel: "Tell me what is going on. Speak or type.",
  boxHint: "Write in your own words. Short is fine.",
  whatNext: "Rumi turns your words into a plan. You can change every line.",
  blank: "Write one sentence first.",
  loading: "Making your plan…",
  makePlan: "Make my plan",
  tryAgain: "Try again",
  errorTitle: "Rumi could not make your plan.",
  degraded: "The AI is not available. Rumi is using simple built-in help.",
  mic: "Speak",
  micStop: "Stop",
  micWorking: "Turning your voice into text.",
  micDenied: "Rumi cannot use the microphone. Allow it in your browser, then try again.",
  micFailed: "That did not work. You can type instead.",
  planHeading: "Your plan",
  planLead: "Check each line. Turn off what you do not want.",
  sourceUser: "You said this",
  sourceSuggested: "Suggested. Off until you turn it on",
  include: "Include this",
  edit: "Edit",
  saveEdit: "Save",
  cancelEdit: "Cancel",
  editLabel: "Change this line",
  remove: "Remove",
  removed: "Removed.",
  undo: "Undo",
  addLabel: "Add my own",
  addButton: "Add line",
  addHint: "One idea in each line.",
  looksRight: "Looks right",
  saved: "Your plan is saved.",
  cardHeading: "How I like to be supported",
  cardLead: "Switch on what helps you. Rumi prints it on your card.",
  customLabel: "Add your own",
  customButton: "Add sentence",
  questionsLegend: "Pick up to 2 questions to bring",
  questionsLimit: "You can pick 2.",
  noQuestions: "Your plan has no questions yet.",
  previewLabel: "Your support card",
  emptyCard: "Nothing is switched on yet.",
  copyCard: "Copy card",
  printCard: "Print card",
  copied: "Copied.",
  copyFailed: "Copy is not available here. The text is selected so you can copy it.",
  goPractice: "Go to Practice",
  off: "Off",
} as const;

/** The six first sentences on a support card (plan 03 step 3). */
export const SUPPORT_PRESETS = [
  { id: "p1", text: "Please speak slowly." },
  { id: "p2", text: "Please ask me one question at a time." },
  { id: "p3", text: "Please write down instructions for me." },
  { id: "p4", text: "Please tell me what will happen before it happens." },
  { id: "p5", text: "I may need extra time to answer." },
  { id: "p6", text: "Please tell me before you touch me." },
] as const;

export const CARD_TEXT = {
  supported: "How I like to be supported",
  concern: "My main concern",
  questions: "My top questions",
  customEmpty: "Write one sentence first.",
  customLong: "Make it shorter and clearer: 15 words or fewer, one idea.",
} as const;

export const KIT_TEXT = {
  planTitle: "My visit plan",
} as const;

export const KIT = {
  goGetReady: "Go to Get ready",
  copyKit: "Copy kit",
  printKit: "Print kit",
  copied: "Copied.",
  copyFailed: "Copy is not available here. The text is selected so you can copy it.",
  previewLabel: "Your kit",
  loading: "Loading your kit…",
} as const;
