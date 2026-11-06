// /practice copy (spec section 4.4 and plan 04). tests/unit/copy.test.ts lints every string.
// {x} style markers are filled in by fill() in src/lib/fill.ts.
export const PRACTICE = {
  loading: "Loading.",

  // No plan
  noPlanTitle: "You need a plan first.",
  noPlanText: "Make your plan in Get ready. Then come back to practice.",
  goGetReady: "Go to Get ready",

  // Picker
  focusLegend: "Part to practice",
  readyLabel: "How ready do I feel? 1 to 5",
  readyHint: "You can skip this.",
  start: "Start practice",
  noLines: "Your plan has no lines for this part.",

  // Call screen
  callTitle: "Practice call.",
  callRegion: "Practice call",
  backTo: "Back to {title}",
  banner: "This is practice. Not a real doctor.",
  logLabel: "Conversation",
  clinician: "Clinician",
  you: "You",
  repeated: "(repeated)",
  thinking: "The clinician is answering.",
  answerLabel: "Your answer",
  send: "Send",
  seeSummary: "See my summary",
  blank: "Type an answer first, or tap Help me say it.",
  micStart: "Speak",
  micStop: "Stop listening",
  pause: "Pause",
  repeat: "Repeat",
  slowDown: "Slow down",
  slowDownDone: "I will speak more slowly.",
  help: "Help me say it",
  showPlan: "Show my plan",
  tryAgain: "Try that again",
  endPractice: "End practice",
  stopReading: "Stop reading",
  toolbarLabel: "Practice tools",
  failed: "Rumi could not answer. Your words are still in the box.",
  failedHelp: "Rumi could not find help just now.",
  failedTitle: "Something went wrong",
  retry: "Try again",

  // Pause
  pausedTitle: "Paused",
  pausedText: "Take the time you need. Nothing moves on until you are ready.",
  resume: "Resume",

  // Leave and end
  leaveTitle: "Leave practice?",
  leaveText: "This practice will not be saved. You can start again any time.",
  keep: "Keep practicing",
  leave: "Leave",
  endTitle: "End practice?",
  endText: "Your answers are saved. Then you see your summary.",
  endNow: "End now",

  // Show my plan
  planTitle: "Your plan",
  planEmpty: "Your plan has no lines on.",
  planConcern: "What is wrong",
  planQuestion: "My questions",
  planAccommodation: "What I need",

  // Help me say it
  helpTitle: "Help me say it",
  helpNothing: "You covered every line of your plan.",
  helpFor: "Help for this line:",
  helpBlankLabel: "Fill in the blank",
  helpFillFirst: "Fill in the blank first.",
  helpUse: "Use this",
  helpMore: "Show more help",
  helpHints: {
    concern: "Say what is wrong and how long it has lasted.",
    question: "Ask the question you wrote down in your plan.",
    accommodation: "Say what would help you in this visit.",
  },

  // Summary
  summaryLead: "Here is how it went.",
  helpCount: { one: "You used Help me say it {n} time.", other: "You used Help me say it {n} times." },
  linesHeading: "Your plan lines",
  linesHint: "Change a line if it is not right.",
  saidIt: "Said it",
  notYet: "Not yet",
  readyAfterLabel: "How ready do I feel now? 1 to 5",
  readyBeforeAfter: "Before: {before}. After: {after}.",
  practiceAgain: "Practice again",
  goHome: "Go to Home",

  // Practice clinician lines (stand-in for the AI until the lane merges)
  script: {
    opener: "Hi. What brings you in today?",
    concern: "Can you tell me more about what is wrong?",
    question: "What would you like to ask me?",
    accommodation: "Is there anything I can do to help you today?",
    closing: "Thank you. That is everything I wanted to ask.",
  },
} as const;
