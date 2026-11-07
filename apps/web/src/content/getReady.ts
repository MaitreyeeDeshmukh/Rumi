// /get-ready, the support card and the kit text builders (plan 04 step 4). tests/unit/copy.test.ts lints every string.
export const GET_READY = {
  boxLabel: "Tell me what is going on. Speak or type.",
  boxHint: "Write in your own words. Short is fine.",
  // Follow-up questions. Each tap answer is the person's own sentence. features/getReady/followUps.ts picks which to ask.
  follow: {
    reason: {
      question: "What is the visit about?",
      chips: ["A check-up.", "Something hurts.", "A question about my medicine.", "A test result.", "How I have been feeling."],
    },
    duration: {
      question: "How long has this been going on?",
      chips: ["It started a few days ago.", "It started a few weeks ago.", "It has been many months.", "It happens now and then."],
    },
    worry: {
      question: "What worries you most?",
      chips: ["I am worried it is serious.", "I am worried about the cost.", "I am worried I will forget things.", "I do not know yet."],
    },
    goal: {
      question: "What do you want from this visit?",
      chips: ["I want to know what is wrong.", "I want a plan for what to do.", "I want a test or a referral.", "I want my medicine checked."],
    },
    tried: {
      question: "What have you tried so far?",
      chips: ["I have tried resting.", "I take medicine for it.", "I have not tried anything yet."],
    },
    change: {
      question: "What makes it better or worse?",
      chips: ["Moving makes it worse.", "Rest makes it better.", "It is worse at night.", "I do not know yet."],
    },
  },
  answerHint: "Type your answer, or tap one.",
  skip: "Skip",
  greeting: "Hello. I am Rumi. I will help you get ready for your visit. What would you like to talk about?",
  thanks: "Thank you for telling me.",
  thinking: "One moment.",
  planNow: "Make my plan now",
  groups: { concern: "What I want to tell", question: "What I want to ask", accommodation: "What would help me" },
  makingPlan: "Thank you. I will make your plan now.",
  threadLabel: "Your chat with Rumi",
  planReady: "Your plan is ready.",
  starters: ["I want to talk about pain.", "I want to talk about sleep.", "I want to talk about a medicine."],
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
  addHint: "Write as much as you like. Rumi splits it into lines.",
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
