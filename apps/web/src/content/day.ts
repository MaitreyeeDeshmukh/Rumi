// Copy for My Day (/home/my-day) and Money Mirror (/home/money), both previews.

export const DAY = {
  title: "My day",
  lead: "A short list for today. Start with one thing.",
  todayTitle: "Today",
  olderTitle: "Still open from before",
  doneTitle: "Done today",
  emptyTitle: "Nothing on today's list",
  emptyText: "Add one small thing. That is enough for a start.",
  addLabel: "Add something to do",
  addHint: "Short is fine. For example: do laundry.",
  add: "Add",
  startWithMe: "Start with me",
  remove: "Remove",
  moneyLink: "Money Mirror",
  moneyText: "A simple view of your week. You enter the numbers.",
  stepsTitle: "Start with me",
  stepsLead: "One small step at a time. Check each one when it is done.",
  stepsOf: "{done} of {total} steps done",
  finish: "Mark the task as done",
  finished: "Task done. Nice work.",
  notFound: "We could not find that task.",
} as const;

export const ENCOURAGEMENT: readonly string[] = [
  "Small steps count. You do not have to do everything today.",
  "Rest is part of the plan, too.",
  "You can change your plans and still be on track.",
  "Doing one thing is better than waiting for the perfect time.",
];

/** Step lists for Start with me. The first list whose keywords appear in the task is used. */
export const STEP_LIBRARY: readonly { keys: readonly string[]; steps: readonly string[] }[] = [
  {
    keys: ["clean", "tidy", "room", "declutter"],
    steps: [
      "Pick one small area, like your desk or your bed.",
      "Get a bag and put any trash in it.",
      "Put clothes in the laundry basket or back in drawers.",
      "Gather cups and dishes to take to the kitchen.",
      "Put five things back where they belong.",
      "Take out the trash and the dishes.",
      "Look around. You can stop here.",
    ],
  },
  {
    keys: ["laundry", "wash clothes"],
    steps: [
      "Gather dirty clothes into one basket.",
      "Take out anything that needs special care.",
      "Put one load in the machine with soap.",
      "Start the machine.",
      "Set a reminder for when it finishes.",
      "Move the clothes to the dryer or a rack.",
      "Fold or hang them when they are dry.",
      "Put them away.",
    ],
  },
  {
    keys: ["dish", "kitchen"],
    steps: ["Clear space next to the sink.", "Wash cups and glasses first.", "Then plates and bowls.", "Then pots and pans.", "Wipe the counter."],
  },
  {
    keys: ["email", "reply", "message", "text"],
    steps: [
      "Open the message you need to answer.",
      "Read it once. Find the one thing they are asking.",
      "Write one sentence that answers that thing.",
      "Add a greeting and your name.",
      "Read it once more. Then send it.",
    ],
  },
  {
    keys: ["grocer", "shopping", "store"],
    steps: [
      "Check what you already have.",
      "Write a short list of what you need.",
      "Pick a store and a time to go.",
      "Bring bags and your list.",
      "Get the things on your list.",
      "Put the food away at home.",
    ],
  },
  {
    keys: ["study", "homework", "essay", "assignment", "exam"],
    steps: [
      "Get your materials in one place.",
      "Pick one small part, like one page or one question.",
      "Work on just that part.",
      "Take a short break.",
      "Pick the next small part.",
      "Write down where you stopped.",
    ],
  },
  {
    keys: ["call", "phone", "appointment"],
    steps: [
      "Write down why you are calling, in one sentence.",
      "Write down details they may ask for, like your date of birth.",
      "Find a quiet spot.",
      "Dial the number. You can read from your notes.",
      "Write down what they tell you.",
    ],
  },
];

export const DEFAULT_STEPS: readonly string[] = [
  "Get what you need in one place.",
  "Do the very first small part. Just that.",
  "Do the next small part.",
  "Check what is left.",
  "Finish up and put things away.",
];

export const MONEY = {
  title: "Money Mirror",
  lead: "A simple view of your week. You enter the numbers. Rumi gives no money advice.",
  budgetTitle: "Weekly budget",
  budgetLabel: "How much do you want to spend this week?",
  budgetHint: "In dollars. For example, 120.",
  budgetSave: "Save budget",
  budgetErr: "Enter a number, like 120.",
  noBudget: "No budget set yet.",
  spentOf: "{spent} spent of {budget}",
  spentOnly: "{spent} spent this week",
  left: "{left} left",
  over: "{over} over the budget",
  addTitle: "Add something you bought",
  whatLabel: "What did you buy?",
  amountLabel: "Amount",
  amountHint: "In dollars. For example, 4.50.",
  categoryLegend: "What kind of thing?",
  add: "Add",
  addErr: "Add a name and an amount above zero.",
  weekTitle: "This week",
  nothing: "Nothing added this week.",
  byKind: "By kind",
  remove: "Remove",
  newWeek: "Start a new week",
  newWeekNote: "This clears this week's list. Your budget stays.",
  newWeekConfirm: "Yes, start a new week",
  newWeekCancel: "Not yet",
  barLabel: "{pct} percent of the weekly budget spent",
} as const;

export const MONEY_KINDS: readonly string[] = ["Food", "Transport", "Fun", "Home", "Health", "Other"];
