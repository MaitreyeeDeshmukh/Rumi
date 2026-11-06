// Copy for Rescue Mode (/home/rescue, preview): calm, one step at a time. Sentences stay short and literal.

export const RESCUE = {
  title: "I am here. What is happening?",
  tabTitle: "Rescue",
  lead: "Pick one, or write it in your own words. We will go one step at a time.",
  preview: "Rescue Mode is a preview. It cannot call anyone or see where you are.",
  options: {
    changed: "My plans changed",
    unsure: "I do not know what to do",
    talk: "I need help talking to someone",
    lost: "I am lost or confused",
    over: "I feel overwhelmed",
  },
  typeLabel: "Or write what is going on",
  typeHint: "For example: my train is not coming.",
  go: "Help me with this",
  trusted: "Contact a trusted person",
  emergency: "In danger right now? Call 911. For a mental health crisis, call or text 988.",
  noEmergency: "Rumi cannot contact emergency services.",
  call911: "Call 911",
  call988: "Call 988",
  text988: "Text 988",
  maybeCrisisTitle: "You deserve support right now",
  maybeCrisis: "If you might hurt yourself, call or text 988. You can also tell someone you trust.",
  startOver: "Start over",
  home: "Go to Home",

  changedTitle: "What changed?",
  changedLead: "Pick the closest one.",
  changed: {
    bus: "My bus or ride was canceled",
    appt: "An appointment was moved or canceled",
    plans: "Someone changed our plans",
    other: "Something else",
  },

  stepN: "Step {n}",
  finished: "Finished",
  done: "Done",
  helpMe: "Help me",
  hideHelp: "Hide help",
  goBack: "Go back",

  overTitle: "Let us slow down",
  overLead: "You are safe to take a pause. Pick what might help right now.",
  over: {
    breathe: "Breathe with me",
    quiet: "Find a quieter place",
    notice: "Notice what is around me",
  },

  breatheTitle: "Breathe with me",
  breatheLead: "Breathe in while the circle grows. Breathe out while it shrinks.",
  breatheIn: "Breathe in",
  breatheOut: "Breathe out",
  breatheStart: "Start",
  breatheStop: "Stop",
  breatheCount: "Round {n} of 5",
  breatheDone: "Nice work. You can stop here or do it again.",
  breatheAgain: "Do it again",

  unsureTitle: "That is okay",
  unsureLead: "Not knowing is normal. Pick one small next step.",
  unsure: {
    breathe: "Take a slow breath first",
    trusted: "Ask someone I trust",
    talk: "Get words to say to someone",
    write: "Write down what happened",
  },
  writeLabel: "What happened?",
  writeHint: "This is not saved. It is only for you, right now.",
  writeNext: "Writing it down can make the next step clearer.",

  trustedTitle: "Contact a trusted person",
  trustedLead: "Pick someone. You choose what to say.",
  noContacts: "You have not added a trusted contact yet.",
  addContacts: "Add a trusted contact",
  messageIdea: "You could send",

  sayTitle: "Help me say it",
  sayLead: "Pick who you are talking to. Then pick what you need.",
  whoLegend: "Who are you talking to?",
  goalLegend: "What do you need?",
  placeLabel: "Where are you trying to go?",
  placeHint: "Optional. It goes into the message.",
  dateLabel: "Which day is the appointment?",
  dateHint: "Optional. For example, Friday.",
  scriptTitle: "You could say",
  copy: "Copy",
  copied: "Copied.",
  copyFailed: "Copy did not work. Select the text and copy it yourself.",
  you: "[your name]",
  place: "[place]",
  day: "[day]",
} as const;

export type RescueStep = {
  id: string;
  text: string;
  detail?: string;
  help?: string;
  list?: readonly string[];
  options?: readonly { label: string; go: string }[];
  go?: string;
  action?: { label: string; href: string };
  final?: boolean;
};

export const FLOWS: Readonly<Record<string, { title: string; steps: readonly RescueStep[] }>> = {
  bus: {
    title: "Bus canceled",
    steps: [
      { id: "s1", text: "Your bus was canceled. We can find what to do next.", detail: "There is usually another way to get there.", help: "You do not have to solve everything at once. Press Done when you are ready." },
      { id: "s2", text: "Find a safe, calm spot to stand or sit while you plan.", help: "A bench at the stop or the inside of a shop works." },
      { id: "s3", text: "Check when the next bus on this route comes.", detail: "Use your transit app or the sign at the stop.", help: "Look for the route number on the sign. You can also ask a driver." },
      { id: "s4", text: "Will the next bus get you there in time?", options: [{ label: "Yes, I can wait", go: "s5a" }, { label: "No, it is too late", go: "s5b" }, { label: "I am not sure", go: "s5c" }] },
      { id: "s5a", text: "Wait for the next bus. Set a reminder a few minutes before it comes.", help: "Keep your pass ready so getting on is easier.", go: "s6" },
      { id: "s5b", text: "Pick another way to get there.", list: ["A different bus or train", "A ride from someone you trust", "A taxi or rideshare, if that works for you", "Walking, if it is close and safe"], help: "Pick the option that feels most familiar.", go: "s6" },
      { id: "s5c", text: "That is okay. Ask someone who works for transit.", help: "You can say: My bus was canceled. What is the best way to get there?", go: "s6" },
      { id: "s6", text: "Tell the person you are meeting that you might be late.", action: { label: "Help me write the message", href: "/home/rescue/say/friend-late" }, help: "A short message is enough." },
      { id: "done", text: "You have a new plan.", detail: "You worked through a change in plans, one step at a time.", final: true },
    ],
  },
  lost: {
    title: "Lost or confused",
    steps: [
      { id: "l1", text: "Stop somewhere safe and out of the way.", help: "A wall, a bench, or the inside of a shop works." },
      { id: "l2", text: "Open a maps app to see where you are.", detail: "The blue dot shows your location.", help: "No maps app? Look for a street sign or a building name." },
      { id: "l3", text: "Look for a sign or street name you know.", help: "Bus stop names and big stores are easy to share with others." },
      { id: "l4", text: "If you want help, ask someone who works nearby.", action: { label: "Help me ask for directions", href: "/home/rescue/say/staff-directions" }, help: "People in a uniform or behind a counter are good to ask." },
      { id: "l5", text: "Tell a trusted person where you are.", action: { label: "Contact a trusted person", href: "/home/rescue/trusted" } },
      { id: "done", text: "You know where you are and what to do next.", final: true },
    ],
  },
  quiet: {
    title: "Find a quieter place",
    steps: [
      { id: "q1", text: "Look for the nearest place with fewer people.", detail: "A restroom, a stairwell or outside often works.", help: "You can say: Excuse me, I need a minute. You do not need to explain." },
      { id: "q2", text: "If you have headphones or sunglasses, now is a good time to use them." },
      { id: "q3", text: "Stay there as long as you need.", help: "There is no timer. Come back to Rumi when you are ready." },
      { id: "done", text: "You found some space.", final: true },
    ],
  },
  notice: {
    title: "Notice what is around me",
    steps: [
      { id: "n1", text: "Name 5 things you can see.", help: "Any five things count. A cup, a light, a door." },
      { id: "n2", text: "Name 4 things you can feel.", help: "Your feet on the ground, your clothes, a chair." },
      { id: "n3", text: "Name 3 things you can hear." },
      { id: "n4", text: "Name 2 things you can smell, or 2 smells you like." },
      { id: "n5", text: "Name 1 thing you could do next. Small is fine." },
      { id: "done", text: "Done. You can stop here or pick another option.", final: true },
    ],
  },
};

export const SAY_WHO: readonly { id: string; label: string }[] = [
  { id: "reception", label: "A receptionist" },
  { id: "staff", label: "A driver or staff member" },
  { id: "friend", label: "A friend or family member" },
  { id: "other", label: "Someone else" },
];

export const SAY_GOALS: Readonly<Record<string, readonly { id: string; label: string }[]>> = {
  reception: [
    { id: "reschedule", label: "Change an appointment" },
    { id: "cancel", label: "Cancel an appointment" },
    { id: "accom", label: "Ask for a quiet place to wait" },
    { id: "question", label: "Ask a question" },
  ],
  staff: [
    { id: "directions", label: "Ask for directions" },
    { id: "stop", label: "Ask which stop to use" },
    { id: "help", label: "Ask for help" },
  ],
  friend: [
    { id: "late", label: "Say I am running late" },
    { id: "cancelplan", label: "Cancel or change plans" },
    { id: "needhelp", label: "Ask for help" },
  ],
  other: [
    { id: "repeat", label: "Ask them to repeat" },
    { id: "time", label: "Ask for more time" },
    { id: "help", label: "Ask for help" },
  ],
};

/** Message templates. {name}, {place} and {day} are filled in on the screen. */
export const SAY_TEMPLATES: Readonly<Record<string, string>> = {
  reschedule: "Hi, my name is {name}. I have an appointment on {day}. I need to change it. What other times do you have?",
  cancel: "Hi, my name is {name}. I have an appointment on {day}. I need to cancel it. Is there anything else I need to do?",
  accom: "Hi, my name is {name}. I have an appointment soon. Could I wait in a quiet place? It would help me.",
  question: "Hi, my name is {name}. I have a question about my appointment. Do you have a minute?",
  directions: "Excuse me, I am lost. Could you help me get to {place}?",
  stop: "Excuse me, which stop should I use to get to {place}?",
  help: "Excuse me, could you help me for a moment? I am not sure what to do next.",
  late: "Hi, my plans changed and I may be about 20 minutes late. I will message you when I am on my way.",
  cancelplan: "Hi, I am sorry. I cannot make it today after all. Could we pick another time?",
  needhelp: "Hi, could you help me with something? I am having a hard time with what to do next.",
  repeat: "Sorry, could you say that again more slowly?",
  time: "Could you give me a moment to think? I want to give you a good answer.",
};

/** What to suggest sending a trusted contact. */
export const TRUSTED_MESSAGE = "Hi, it is {name}. Plans changed and I could use some help. Can you call or text me?";
