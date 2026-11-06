// Copy and made-up sample data for Circles (/home/circles, preview). No real people, groups or places.

export const CIRCLES = {
  title: "Circles",
  lead: "Find your people. Small groups with clear plans and no pressure to talk.",
  preview: "Circles is not live yet. Every group, person and message here is made up.",
  all: "All circles",
  mine: "My circles",
  view: "Which circles to show",
  styleLegend: "How do you like to talk?",
  any: "Any way",
  noneJoined: "You have not joined a circle yet.",
  noneMatch: "No circles match. Try another way to talk.",
  comingUp: "Coming up in your circles",
  comfortLink: "How I like to connect",
  comfortText: "Tell circles what helps you.",
  members: "{n} members",

  join: "Join this circle",
  leave: "Leave this circle",
  joined: "You joined. You can leave any time.",
  left: "You left the circle.",
  openChat: "Open the chat",
  joinToChat: "Join this circle to see the chat.",
  events: "Events",
  noEvents: "No events planned.",
  rules: "Circle rules",
  people: "Some members",
  peopleNote: "Made-up members for the preview.",

  chatTitle: "{name} chat",
  chatLead: "Write when you like. Late replies are normal here.",
  starters: "Ideas to start",
  messageLabel: "Your message",
  send: "Send",
  you: "You",
  demoReply: "Made-up reply",
  report: "Report",
  reportTitle: "Why are you reporting this?",
  reportSave: "Report message",
  reportCancel: "Cancel",
  reported: "You reported this message. It is hidden for you.",
  reportNote: "In the real app, a person on our team would review reports.",
  minutesAgo: "{n} min ago",
  hoursAgo: "{n} hr ago",
  justNow: "Just now",

  when: "When",
  where: "Where",
  activity: "What you will do",
  size: "Group size",
  rsvp: "Are you going?",
  going: "Going",
  notGoing: "Not going",
  goingNote: "You are going. The host would see this in the real app.",
  bring: "What to bring",
  expect: "What to expect",
  leaveEarly: "If you want to leave early",
  access: "Access",
  prep: "Get ready for this meetup",
  prepTitle: "Get ready for this meetup",
  prepLead: "Check things off as you go. Talking is never required.",
  checklist: "Checklist",
  doneOf: "{done} of {total} done",
  startersOptional: "Things you could say",

  comfortTitle: "How I like to connect",
  comfortLead: "Pick what is true for you. Circles you join could see this in the real app.",
  comfortSaved: "Saved on this device.",
} as const;

export const COMM_STYLES: readonly string[] = ["Text first", "Talking optional", "Slow chat", "Voice optional", "Camera off is fine", "Plan shared ahead"];

export const REPORT_REASONS: readonly string[] = ["Made me uncomfortable", "Spam or selling", "Unsafe meetup", "Bullying", "Something else"];

export const COMFORT_PREFS: readonly string[] = [
  "I prefer smaller groups.",
  "I prefer chatting before meeting.",
  "I need time to respond.",
  "I prefer quiet places.",
  "Talking is optional for me.",
  "I like knowing the plan ahead.",
];

export const PREP_ITEMS: readonly string[] = [
  "Know how I am getting there",
  "Check the start and end time",
  "Charge my phone",
  "Pick one thing I could say",
  "Decide how I will leave if I need to",
];

export type Group = {
  id: string;
  name: string;
  desc: string;
  members: number;
  mode: string;
  size: string;
  comm: readonly string[];
  rules: readonly string[];
  people: readonly string[];
  starters: readonly string[];
  welcome: string;
};

export const GROUPS: readonly Group[] = [
  {
    id: "coffee",
    name: "Quiet Coffee Club",
    desc: "Low-key coffee meetups. Talking is optional. Sitting together counts.",
    members: 18,
    mode: "Local",
    size: "Small",
    comm: ["Talking optional", "Plan shared ahead"],
    rules: ["Talking is always optional.", "Plans are posted at least 3 days ahead.", "Leaving early is fine. No reason needed."],
    people: ["Maya R.", "Theo K.", "Ines P.", "Jules W."],
    starters: ["What is your usual coffee order?", "Do you know a quiet café nearby?", "What are you reading lately?"],
    welcome: "Nice to see you here. Saturday is relaxed. Come as you are.",
  },
  {
    id: "creative",
    name: "Creative Corner",
    desc: "Drawing, writing, crafts and music. Share what you are making, or just watch.",
    members: 64,
    mode: "Online",
    size: "Medium",
    comm: ["Text first", "Camera off is fine"],
    rules: ["Give feedback only when someone asks.", "Credit other people's work.", "Camera and mic are always optional."],
    people: ["Ari L.", "Bea N.", "Kai M.", "Rosa T."],
    starters: ["What are you working on this week?", "What got you into making things?"],
    welcome: "Welcome! There is no pressure to share. We would love to see what you make.",
  },
  {
    id: "gaming",
    name: "Gaming After Hours",
    desc: "Co-op nights and cozy games. Players who only text are welcome.",
    members: 142,
    mode: "Online",
    size: "Large",
    comm: ["Voice optional", "Text first"],
    rules: ["No trash talk.", "Voice chat is optional.", "Game nights end on time."],
    people: ["Nico B.", "Sana H.", "Leo F.", "Wren J."],
    starters: ["What game are you playing right now?", "Do you like co-op or solo games?"],
    welcome: "Hi! Text only is fine on co-op nights.",
  },
  {
    id: "adulting",
    name: "Adulting Together",
    desc: "Budgets, cooking, appointments, laundry. Ask the questions nobody explained.",
    members: 87,
    mode: "Online",
    size: "Medium",
    comm: ["Slow chat", "Plan shared ahead"],
    rules: ["No question is too basic.", "Be kind about mistakes.", "No selling."],
    people: ["Lena V.", "Marco D.", "Hana I."],
    starters: ["What adult task took you longest to learn?", "How do you keep track of bills?"],
    welcome: "Welcome! No question is too basic in here.",
  },
  {
    id: "study",
    name: "Study Buddies",
    desc: "Quiet work sessions for school, work or your own projects.",
    members: 41,
    mode: "Online",
    size: "Medium",
    comm: ["Camera off is fine", "Talking optional"],
    rules: ["Sessions are quiet unless someone asks.", "Breaks are good."],
    people: ["June O.", "Sid R.", "Eli M."],
    starters: ["What are you studying today?", "Do you like short or long work blocks?"],
    welcome: "Hi! Join a session any time. Camera off is fine.",
  },
];

export type CircleEvent = {
  id: string;
  groupId: string;
  title: string;
  /** Days from today. -1 means the next Saturday. */
  inDays: number;
  time: string;
  end: string;
  where: string;
  activity: string;
  size: string;
  bring: readonly string[];
  expect: readonly string[];
  leave: string;
  access: readonly string[];
};

export const EVENTS: readonly CircleEvent[] = [
  {
    id: "coffee-sat",
    groupId: "coffee",
    title: "Saturday Coffee Circle",
    inDays: -1,
    time: "10:00",
    end: "11:30",
    where: "Corner tables at Lumen Café (made up), 4th Ave",
    activity: "Coffee and calm chat. Bring a book if you want something to do.",
    size: "4 to 6 people",
    bring: ["Money for a drink, about $5", "Headphones if you like"],
    expect: ["The host waits at the corner table with a small green card.", "People say hello, then chat or read.", "It is usually quiet before 11."],
    leave: "You can tell the host you are heading out. No reason needed.",
    access: ["No steps at the door", "Quiet corner", "Restroom on site"],
  },
  {
    id: "creative-sketch",
    groupId: "creative",
    title: "Open sketch hour",
    inDays: 3,
    time: "17:00",
    end: "18:00",
    where: "Video room. Camera is optional.",
    activity: "Everyone works on their own thing. Share at the end if you want.",
    size: "5 to 10 people",
    bring: ["Anything you like to make"],
    expect: ["A quick hello in the chat.", "Then 45 quiet minutes.", "You can show your work at the end if you want."],
    leave: "Just leave the room. No goodbye needed.",
    access: ["Camera optional", "Chat only is fine"],
  },
  {
    id: "gaming-coop",
    groupId: "gaming",
    title: "Cozy co-op night",
    inDays: 5,
    time: "20:00",
    end: "22:00",
    where: "Group voice room, with a text channel",
    activity: "Easy co-op games. The host picks something simple to join.",
    size: "4 to 8 people",
    bring: ["A controller or keyboard"],
    expect: ["The game is posted the day before.", "Teams are picked at random."],
    leave: "Type heading off in the chat.",
    access: ["Text only is fine"],
  },
  {
    id: "study-sprint",
    groupId: "study",
    title: "Silent study sprint",
    inDays: 1,
    time: "15:00",
    end: "16:30",
    where: "Video room. Camera off is fine.",
    activity: "Two 40-minute work blocks with a break between.",
    size: "5 to 12 people",
    bring: ["Whatever you want to work on"],
    expect: ["Post your goal in the chat.", "Quiet work.", "A break in the middle."],
    leave: "Leave any time.",
    access: ["Camera off is fine"],
  },
];

export const SEED_MESSAGES: Readonly<Record<string, readonly { id: string; user: string; text: string; minsAgo: number }[]>> = {
  coffee: [
    { id: "c1", user: "Maya R.", text: "Morning! I posted the Saturday plan. Same corner table as last time.", minsAgo: 260 },
    { id: "c2", user: "Theo K.", text: "Thanks. Is it okay if I just read for most of it?", minsAgo: 200 },
    { id: "c3", user: "Maya R.", text: "Totally okay. Reading together counts.", minsAgo: 190 },
    { id: "c4", user: "Ines P.", text: "I might be 10 minutes late. I will post here when I arrive.", minsAgo: 45 },
  ],
  creative: [
    { id: "r1", user: "Ari L.", text: "I finished the little moth drawing from last week. I like the wings.", minsAgo: 400 },
    { id: "r2", user: "Rosa T.", text: "Any tips for drawing hands? Mine look like forks.", minsAgo: 120 },
  ],
  gaming: [
    { id: "g1", user: "Nico B.", text: "Co-op night is on. I will post the game tomorrow.", minsAgo: 600 },
    { id: "g2", user: "Wren J.", text: "Can I join with text only again?", minsAgo: 90 },
    { id: "g3", user: "Nico B.", text: "Always.", minsAgo: 80 },
  ],
  adulting: [{ id: "a1", user: "Lena V.", text: "Today I learned the pharmacy can text you when a refill is ready.", minsAgo: 300 }],
  study: [{ id: "s1", user: "June O.", text: "Sprint tomorrow at 3. I will post the room link here.", minsAgo: 150 }],
};
