// /home copy (spec section 7.1) and the words the dashboard logic uses. tests/unit/copy.test.ts lints every string.
// {name} style markers are filled in by fill() in src/lib/fill.ts.
export const NEXT_STEPS = {
  make_plan: {
    href: "/get-ready",
    label: "Make your plan",
    sentence: "Rumi will turn your words into a plan. You can change everything.",
  },
  finish_card: {
    href: "/get-ready",
    label: "Finish your support card",
    sentence: "Pick how you like to be supported.",
  },
  practice: {
    href: "/practice",
    label: "Start practice",
    sentence: "Talk with a practice clinician. This is not a real doctor.",
  },
  remember: {
    href: "/remember",
    label: "Try the sample visit",
    sentence: "See what Rumi can do with a made-up visit.",
  },
  kit: {
    href: "/kit",
    label: "See your kit",
    sentence: "Your plan and support card are in one place.",
  },
} as const;

export const STATUS = {
  notStarted: "Not started",
  inProgress: "In progress",
  done: "Done",
} as const;

/** Index = help level 0 to 3. */
export const HELP_LEVEL_WORDS = ["No help", "A hint", "A sentence with blanks", "A full sentence"] as const;

/** The same levels inside "Last time you needed ...". */
export const HELP_LEVEL_NEEDED = ["no help", "a hint", "a sentence with blanks", "a full sentence"] as const;

export const HELP_KIND_LABELS = {
  concern: "Describing what is wrong",
  question: "Asking your questions",
  accommodation: "Asking for what you need",
} as const;

/** The five practice focuses (plan 02). */
export const FOCUS_LABELS = {
  problem: "Explain my problem",
  questions: "Ask my questions",
  needs: "Ask for what I need",
  next_steps: "Understand what to do next",
  whole: "The whole visit",
} as const;

export const TREND = {
  before: "Last time you needed",
  after: "This time you needed",
} as const;

export const HOME = {
  greeting: "Hi.",
  greetingName: "Hi, {name}.",
  loading: "Loading.",
  storageOff: "Your browser is not saving data. Your work will be lost when you close this page.",
  nextHeading: "Next step",
  stepsHeading: "Your three steps",
  openStep: "Open {step}",
  planHeading: "Your plan",
  linesOn: { one: "{n} line on", other: "{n} lines on" },
  linesOff: { one: "{n} line off", other: "{n} lines off" },
  editPlan: "Edit plan",
  noPlan: "No plan yet.",
  practiceHeading: "Last practice",
  practiced: "You practiced: {focus}.",
  saidMyself: "You said {x} of {y} things yourself.",
  saidWithHelp: "You said {z} with help.",
  practiceAgain: "Practice again",
  noPractice: "No practice yet.",
  helpHeading: "Help you usually need",
  helpCaption: "Where your next practice starts.",
  kitHeading: "Your kit",
  kitReady: "Your kit is ready.",
  openKit: "Open kit",
  kitNeeds: "Your kit needs a plan and a support card.",
  goGetReady: "Go to Get ready",
  quickHeading: "Quick links",
  sayIt: "I need help saying something",
  share: "Share something",
  settings: "Settings",
  privacyHeading: "Privacy",
  saved: "Your plan is saved on this device.",
  memory: "Memory: {state}",
  memoryOn: "On",
  memoryOff: "Off",
  memoryTurnOn: "Turn on Memory",
  memoryNotNow: "Not now",
  memoryWorking: "Working on it.",
  manage: "Manage in Settings",
} as const;
