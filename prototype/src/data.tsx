// Rumi prototype: sample data and simulated logic. Everything here is fictional demo content.
import { addDays, nextWeekday, has, todayISO } from './core';

// ---------- Practice scenarios (communication simulations, not medical consultations) ----------
type Node = { q: string; topic: string; say: string[]; next?: (t: string) => string; end?: boolean };
export const SCENARIOS: Record<string, { title: string; who: string; role: string; icon: string; desc: string; start: string; nodes: Record<string, Node> }> = {
  general: {
    title: 'General health visit', who: 'Dr. Lee', role: 'Primary care', icon: 'steth', desc: 'A check-up or a visit about something that has been bothering you.', start: 'g1',
    nodes: {
      g1: { q: "Hi, I'm Dr. Lee. What brings you in today?", topic: 'Reason for the visit', say: ["I've had headaches most afternoons for about two weeks.", "I'm here for a check-up. Nothing specific is wrong.", 'I wrote some notes. Is it okay if I read from them?'],
        next: t => has(t, ['check', 'physical', 'routine', 'yearly', 'annual', 'nothing']) ? 'g2c' : has(t, ['pain', 'hurt', 'ache', 'sore', 'headache']) ? 'g2p' : has(t, ['tired', 'sleep', 'energy', 'exhausted']) ? 'g2s' : has(t, ['anxious', 'stress', 'worried', 'mood', 'sad', 'overwhelm']) ? 'g2m' : has(t, ['notes', 'read']) ? 'g2n' : 'g2o' },
      g2p: { q: 'Thanks for telling me. Where do you feel it, and when did it start?', topic: 'Describing symptoms', say: ["It's mostly behind my eyes. It started about two weeks ago.", "It comes and goes. It's worse in the afternoon."], next: () => 'g3' },
      g2s: { q: 'Okay. How has your sleep been over the last few weeks?', topic: 'Describing symptoms', say: ['I fall asleep late and wake up tired.', "It's been about the same, but I feel tired during the day."], next: () => 'g3' },
      g2m: { q: 'Thank you for sharing that. How long have you been feeling this way?', topic: 'Describing how you feel', say: ['For about a month.', "I'm not sure exactly. It's been a while."], next: () => 'g3' },
      g2n: { q: "Of course. Reading from notes is a great idea. Go ahead whenever you're ready.", topic: 'Using your notes', say: ['My main concern is headaches. They started two weeks ago.', 'First, I want to ask about my sleep.'], next: t => has(t, ['pain', 'headache', 'hurt']) ? 'g2p' : 'g3' },
      g2c: { q: "A check-up is a good idea. Is there anything you'd like me to look at while you're here?", topic: 'Reason for the visit', say: ['No, just a general check.', "Yes, I'd like to ask about my sleep."], next: t => has(t, ['sleep', 'tired']) ? 'g2s' : 'g4' },
      g2o: { q: 'Thanks. Can you tell me a little more? When did you first notice it?', topic: 'Describing symptoms', say: ['I first noticed it last week.', "I'm not sure how to describe it. Can I show you on my notes?"], next: () => 'g3' },
      g3: { q: 'Is it getting better, getting worse, or staying about the same?', topic: 'How things are changing', say: ["It's staying about the same.", "It's a little worse than before.", "I'm not sure."], next: () => 'g4' },
      g4: { q: 'Are you taking any medicines right now? That includes vitamins or things from the pharmacy.', topic: 'Medicines', say: ["No, I'm not taking anything.", 'Yes. I brought a list. Can I read it to you?'], next: () => 'g5' },
      g5: { q: 'Is there anything that would make this visit easier for you, like the lights or how I explain things?', topic: 'Asking for accommodations', say: ['Could you tell me each step before you do it?', 'Could we turn the lights down a little?', 'I might need a moment before I answer. That is normal for me.'], next: () => 'g6' },
      g6: { q: 'What questions do you have for me?', topic: 'Asking your own questions', say: ['What should I do if it gets worse?', 'Could you write down the next steps for me?', 'No questions right now. Thank you.'], next: () => 'end' },
      end: { q: "Thanks for practicing with me. You can end the practice whenever you're ready.", topic: '', say: [], end: true },
    },
  },
  dentist: {
    title: 'Dentist appointment', who: 'Dr. Patel', role: 'Dentist', icon: 'tooth', desc: 'A cleaning, a check-up, or a tooth that has been bothering you.', start: 'd1',
    nodes: {
      d1: { q: "Hi, I'm Dr. Patel. What brings you in today?", topic: 'Reason for the visit', say: ["I'm here for a cleaning.", 'One of my teeth hurts when I drink cold things.', "I'm nervous about the dentist. Can we go slowly?"],
        next: t => has(t, ['nervous', 'scared', 'anxious', 'slow', 'worried']) ? 'd2n' : has(t, ['hurt', 'pain', 'sensitive', 'cold', 'ache']) ? 'd2p' : has(t, ['clean', 'check']) ? 'd2c' : 'd2o' },
      d2n: { q: "Thanks for telling me. We can go as slowly as you need. Would it help if I explain each step first?", topic: 'Asking for accommodations', say: ['Yes, please explain before you start each part.', 'Could I have a signal to ask you to stop?'], next: () => 'd3' },
      d2p: { q: "I'm sorry it's bothering you. Which tooth is it, and how long has it felt like this?", topic: 'Describing symptoms', say: ["It's on the bottom left. About a week.", "I'm not sure which tooth. It's somewhere on the right side."], next: () => 'd3' },
      d2c: { q: 'Great. Have you noticed anything different with your teeth or gums lately?', topic: 'Reason for the visit', say: ['No, nothing different.', 'My gums bleed a little when I brush.'], next: () => 'd3' },
      d2o: { q: 'Okay. Can you tell me a bit more about that?', topic: 'Describing symptoms', say: ["It's hard to describe. It feels strange when I chew.", 'I just want a check-up.'], next: () => 'd3' },
      d3: { q: 'Some people like a signal to pause, like raising a hand. Would that help you today?', topic: 'Asking for accommodations', say: ["Yes. I'll raise my left hand if I need a break.", "I don't think I need one, but thank you."], next: () => 'd4' },
      d4: { q: 'The tools can be a bit loud. Would you like to wear your own headphones?', topic: 'Sensory needs', say: ['Yes, I brought headphones.', "That's okay. I'm fine with the sound."], next: () => 'd5' },
      d5: { q: 'Do you have any questions before we start?', topic: 'Asking your own questions', say: ['How long will this take?', 'Will it hurt?', 'No, I think I am ready.'], next: () => 'end' },
      end: { q: "That's the end of the practice. You did the talking part. End whenever you're ready.", topic: '', say: [], end: true },
    },
  },
  therapy: {
    title: 'Therapy intake', who: 'Alex', role: 'Counselor', icon: 'chat2', desc: 'A first conversation with a new counselor or therapist.', start: 't1',
    nodes: {
      t1: { q: "Hi, I'm Alex. Thanks for coming in. What made you decide to reach out?", topic: 'Reason for reaching out', say: ["School has been a lot lately, and I'd like help managing it.", "I've been feeling stressed most days.", "I'm not totally sure. Someone suggested I try it."],
        next: t => has(t, ['school', 'work', 'job', 'class']) ? 't2w' : has(t, ['stress', 'anxious', 'worried', 'overwhelm']) ? 't2a' : has(t, ['friend', 'people', 'lonely', 'family', 'social']) ? 't2r' : has(t, ['not sure', 'suggested', "don't know"]) ? 't2u' : 't2o' },
      t2w: { q: 'That makes sense. What part of school or work feels the hardest right now?', topic: 'Describing what is hard', say: ['Keeping track of deadlines.', 'Group projects and talking in class.'], next: () => 't3' },
      t2a: { q: 'Thank you for sharing that. When do you notice the stress the most?', topic: 'Describing what is hard', say: ['Mostly in the mornings.', 'When plans change without warning.'], next: () => 't3' },
      t2r: { q: 'Relationships can be a lot. Can you tell me a bit more about that?', topic: 'Describing what is hard', say: ["I want more friends, but I don't know where to start.", "Things at home have been tense."], next: () => 't3' },
      t2u: { q: "That's completely okay. Lots of people start that way. What would you like to be different?", topic: 'Your goals', say: ['I would like to feel calmer during the week.', "I'm not sure yet. Can we figure it out together?"], next: () => 't3' },
      t2o: { q: 'Okay. Could you say a little more about that?', topic: 'Describing what is hard', say: ["It's hard to put into words.", 'Can I write it down instead?'], next: () => 't3' },
      t3: { q: 'How do you like to communicate? Some people prefer to write things down or take breaks.', topic: 'Communication preferences', say: ['I sometimes need extra time to answer.', 'It helps if I can type instead of talk.', 'Direct questions are easier for me than open ones.'], next: () => 't4' },
      t4: { q: 'What would you like to get out of our sessions?', topic: 'Your goals', say: ['Ways to handle changes in plans.', 'A plan for busy weeks.'], next: () => 't5' },
      t5: { q: 'Do you have any questions for me?', topic: 'Asking your own questions', say: ['How often would we meet?', 'What happens if I need to cancel?', 'Is what I say here private?'], next: () => 'end' },
      end: { q: "That's the end of this practice. Thank you for practicing. End whenever you're ready.", topic: '', say: [], end: true },
    },
  },
};

// ---------- Help Me Organize (deterministic, on-device rules) ----------
export function organizeNotes(text: string) {
  const parts = text.replace(/([.!?])\s+/g, '$1\n').split('\n').map(p => p.trim().replace(/^[-*•]\s*/, '')).filter(Boolean);
  const out = { symptoms: [] as string[], questions: [] as string[], nervous: [] as string[], accom: [] as string[], other: [] as string[] };
  parts.forEach(p => {
    const l = p.toLowerCase();
    if (p.endsWith('?') || /^(what|how|why|can|could|should|is|are|do|does|will|when|where)\b/.test(l)) out.questions.push(p.endsWith('?') ? p : p + '?');
    else if (has(l, ['nervous', 'worried', 'scared', 'anxious', 'afraid', "don't like", 'dont like', 'hate', 'stress'])) out.nervous.push(p);
    else if (has(l, ['need', 'please', 'prefer', 'quiet', 'light', 'noise', 'loud', 'break', 'write', 'explain', 'headphones', 'wait', 'slow'])) out.accom.push(p);
    else if (has(l, ['pain', 'hurt', 'ache', 'feel', 'since', 'started', 'tired', 'sleep', 'days', 'weeks', 'sore', 'cough', 'dizzy', 'headache', 'rash', 'eat'])) out.symptoms.push(p);
    else out.other.push(p);
  });
  return out;
}

// ---------- Call script ----------
export function callScript(a: any, name: string) {
  const lines: string[] = [];
  lines.push(`Hi, my name is ${name || '[your name]'}.`);
  lines.push(`I'd like to make ${a.kind ? 'a ' + a.kind.toLowerCase() : 'an'} appointment${a.reason ? ' for ' + a.reason.toLowerCase().replace(/\.$/, '') : ''}.`);
  if (a.provider) lines.push(`If possible, I'd like to see ${a.provider.replace(/\s*\(.*\)/, '')}.`);
  lines.push(`I'd prefer ${a.mode === 'virtual' ? 'a virtual visit' : 'an in-person visit'}.`);
  if (a.date) lines.push(`Do you have anything around ${new Date(a.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${a.time ? ', around ' + a.time : ''}?`);
  if (a.accom && a.accom.length) lines.push(`I also have a request. ${a.accom.map((x: string) => x.toLowerCase()).join(', and ').replace(/^./, (c: string) => c.toUpperCase())}, if possible.`);
  lines.push('Could you repeat the date and time so I can write it down?');
  return lines.join('\n');
}

export const SAMPLE_PROVIDERS = [
  { name: 'Dr. Maya Lee', kind: 'Primary care', where: 'Northside Health Center (example)', note: 'Offers early quiet appointments', mode: 'In person or virtual' },
  { name: 'Dr. Sam Okafor', kind: 'Primary care', where: 'Riverbend Clinic (example)', note: 'Lists sensory-friendly rooms', mode: 'In person' },
  { name: 'Dr. Ana Ruiz', kind: 'Family medicine', where: 'Telehealth (example)', note: 'Text chat before visits', mode: 'Virtual only' },
];

// ---------- Sample transcript (fictional) ----------
export const SAMPLE_TRANSCRIPT = {
  title: 'Visit with Dr. Lee (sample)',
  date: addDays(-3),
  lines: [
    { s: 'Doctor', t: 'Hi Sam, what brings you in today?' },
    { s: 'Patient', t: "I've been getting headaches most afternoons for about three weeks." },
    { s: 'Doctor', t: 'Okay. Do they happen at the same time each day?', tag: 'discussed', sum: 'Headaches most afternoons for about three weeks.' },
    { s: 'Patient', t: "Mostly after class, when I've been on my laptop a lot." },
    { s: 'Doctor', t: 'Has anything helped so far?', tag: 'discussed', sum: 'Headaches often come after long laptop time. Lying down in a dark room helps a little.' },
    { s: 'Patient', t: 'Lying down in a dark room helps a little.' },
    { s: 'Doctor', t: 'Your blood pressure looks normal today, and your eye check looked normal too.', tag: 'discussed', sum: 'Blood pressure and eye check looked normal at this visit.' },
    { s: 'Doctor', t: "I'd like you to keep a headache diary for two weeks. Write down when it starts, how strong it feels, and what you were doing.", tag: 'instructions', sum: 'Keep a headache diary for two weeks: start time, how strong, what you were doing.' },
    { s: 'Doctor', t: 'Try taking a short screen break every hour, and drink water through the day.', tag: 'instructions', sum: 'Take a short screen break every hour and drink water through the day.' },
    { s: 'Doctor', t: "If you use an over-the-counter pain reliever, follow the package directions, and let us know if you're needing it more than a couple of days a week.", tag: 'medications', sum: 'Over-the-counter pain reliever: follow package directions. Tell the office if needed more than a couple of days a week.', clarify: 'Which pain reliever is okay for you, and what counts as "a couple of days"?' },
    { s: 'Patient', t: 'Should I be worried about the headaches?' },
    { s: 'Doctor', t: 'Nothing worrying stood out today. Call us sooner if a headache is sudden and severe, or comes with changes in your vision.', tag: 'instructions', sum: 'Call sooner if a headache is sudden and severe, or comes with vision changes.', clarify: 'Who should you call after hours?' },
    { s: 'Doctor', t: "Let's have you come back in about four weeks, and bring the diary with you.", tag: 'followup', sum: 'Come back in about four weeks. Bring the headache diary.', clarify: 'Confirm the exact date and time of the follow-up.' },
    { s: 'Patient', t: 'Okay. Do I need to book that now?' },
    { s: 'Doctor', t: 'Yes, the front desk can set it up on your way out.', tag: 'next', sum: 'Book the follow-up at the front desk.' },
  ],
};
export const SUMMARY_SECTIONS = [
  { key: 'discussed', title: 'What was discussed', icon: 'bubble' },
  { key: 'instructions', title: 'Important instructions', icon: 'list' },
  { key: 'medications', title: 'Medications mentioned', icon: 'notes' },
  { key: 'next', title: 'Next steps', icon: 'chev' },
  { key: 'followup', title: 'Follow-up appointment', icon: 'cal' },
  { key: 'clarify', title: 'Questions to clarify', icon: 'help' },
];
export function summarizeTranscript(tr: typeof SAMPLE_TRANSCRIPT) {
  const sections: Record<string, { text: string; line?: number }[]> = {};
  SUMMARY_SECTIONS.forEach(s => (sections[s.key] = []));
  tr.lines.forEach((l: any, i: number) => {
    if (l.tag && l.sum) sections[l.tag].push({ text: l.sum, line: i + 1 });
    if (l.clarify) sections.clarify.push({ text: l.clarify, line: i + 1 });
  });
  return sections;
}

// ---------- Circles ----------
export const GROUPS = [
  { id: 'coffee', name: 'Quiet Coffee Club', desc: 'Low-key coffee meetups. Talking is optional, and sitting together counts.', members: 18, topic: 'Food and drink', mode: 'Local', size: 'Small', comm: ['Talking optional', 'Plan shared ahead'], tone: 'apricot',
    rules: ['Talking is always optional.', 'Plans are posted at least 3 days ahead.', 'Leaving early is fine. No explanation needed.', 'No pressure to share personal details.'],
    people: ['Maya R.', 'Theo K.', 'Ines P.', 'Jules W.', 'Dev S.'],
    starters: ["What's your usual coffee order?", 'Anyone tried a quiet café nearby?', 'What are you reading or watching lately?'] },
  { id: 'creative', name: 'Creative Corner', desc: 'Drawing, writing, crafts and music. Share works in progress or just watch.', members: 64, topic: 'Art and making', mode: 'Online', size: 'Medium', comm: ['Text first', 'Camera off is fine'], tone: 'lav',
    rules: ['Feedback only when someone asks for it.', 'Credit other people\'s work.', 'Camera and mic are always optional.'],
    people: ['Ari L.', 'Bea N.', 'Kai M.', 'Rosa T.'],
    starters: ['What are you working on this week?', 'Share a color you like right now.', 'What got you into making things?'] },
  { id: 'gaming', name: 'Gaming After Hours', desc: 'Co-op nights, cozy games and chill voice chat. Text-only players welcome.', members: 142, topic: 'Games', mode: 'Online', size: 'Large', comm: ['Voice optional', 'Text first'], tone: 'blue',
    rules: ['No trash talk.', 'Voice chat is optional.', 'Game nights end on time.'],
    people: ['Nico B.', 'Sana H.', 'Leo F.', 'Wren J.'],
    starters: ['What game are you playing right now?', 'Co-op or solo?', 'Any cozy game recommendations?'] },
  { id: 'adhd', name: 'ADHD Life Hacks', desc: 'Tips and tools for focus, routines and remembering stuff. Open to anyone who finds them useful.', members: 230, topic: 'Life skills', mode: 'Online', size: 'Large', comm: ['Slow chat', 'Text first'], tone: 'sage',
    rules: ['Share what works for you, not what others should do.', 'No medical advice.', 'Late replies are normal here.'],
    people: ['Priya D.', 'Omar A.', 'Tess G.', 'Ben C.'],
    starters: ['What tool helps you remember things?', 'Best timer app?', 'How do you start a boring task?'] },
  { id: 'adulting', name: 'Adulting Together', desc: 'Budgets, cooking, appointments, laundry. Ask the questions nobody explained.', members: 87, topic: 'Life skills', mode: 'Online', size: 'Medium', comm: ['Slow chat', 'Plan shared ahead'], tone: 'apricot',
    rules: ['No question is too basic.', 'Be kind about mistakes.', 'No selling or sharing money tips as advice.'],
    people: ['Lena V.', 'Marco D.', 'Hana I.'],
    starters: ['What adult task took you the longest to figure out?', 'Easy dinner ideas?', 'How do you keep track of bills?'] },
  { id: 'study', name: 'Study Buddies', desc: 'Quiet co-working sessions for school, work or personal projects.', members: 41, topic: 'Learning', mode: 'Online', size: 'Medium', comm: ['Camera off is fine', 'Talking optional'], tone: 'blue',
    rules: ['Sessions are quiet by default.', 'Say what you plan to work on, if you want.', 'Breaks are encouraged.'],
    people: ['June O.', 'Sid R.', 'Eli M.'],
    starters: ["What are you studying today?", 'Pomodoro or longer blocks?', 'Favorite study music?'] },
  { id: 'books', name: 'Book and Movie Club', desc: 'One book or film a month. Chat in text, then meet in a small group if you like.', members: 26, topic: 'Books and film', mode: 'Local', size: 'Small', comm: ['Chat before meeting', 'Plan shared ahead'], tone: 'lav',
    rules: ['No spoilers without a warning.', 'All opinions welcome.', 'Meetups are small, 6 people or fewer.'],
    people: ['Iris Q.', 'Felix N.', 'Zoe A.', 'Ravi K.'],
    starters: ['What did you think of the ending?', 'Any recommendations for next month?', 'Book or movie first?'] },
];
export const FILTERS = {
  interest: ['Food and drink', 'Art and making', 'Games', 'Life skills', 'Learning', 'Books and film'],
  size: ['Small', 'Medium', 'Large'],
  mode: ['Online', 'Local'],
  comm: ['Text first', 'Talking optional', 'Slow chat', 'Voice optional', 'Camera off is fine', 'Plan shared ahead', 'Chat before meeting'],
};

const sat = nextWeekday(6);
export const SEED_EVENTS = [
  { id: 'e-coffee', groupId: 'coffee', title: 'Saturday Coffee Circle', date: sat, time: '10:00', end: '11:30', locType: 'Café', where: 'Corner tables at Lumen Café (example), 4th Ave', activity: 'Coffee and casual chat. Bring a book if you want something to do with your hands.', size: '4 to 6 people', bring: ['Money for a drink, about $5', 'Headphones if you like'], expect: ['The host waits at the corner table with a small green card.', 'Hellos, then people chat or read.', 'It is usually quiet before 11.'], leave: 'Say "I\'m heading out, see you next time." No reason needed. You can also just message the host.', access: ['Step-free entrance', 'Quiet corner', 'Restroom on site'], attendees: ['Maya R.', 'Theo K.', 'Ines P.'] },
  { id: 'e-books', groupId: 'books', title: 'Movie night watch-along', date: addDays(9), time: '19:00', end: '21:00', locType: 'Online', where: 'Text chat in this group, watch on your own screen', activity: 'Press play together, chat in text if you want.', size: 'Up to 8 people', bring: ['The movie, on any service', 'Snacks'], expect: ['Countdown to press play together.', 'Chat is optional during the film.', 'Short chat after, if people want.'], leave: 'Leave any time. Turning off notifications is fine.', access: ['Captions recommended', 'No camera'], attendees: ['Iris Q.', 'Zoe A.'] },
  { id: 'e-creative', groupId: 'creative', title: 'Open sketch hour', date: addDays(3), time: '17:00', end: '18:00', locType: 'Online', where: 'Video room, camera optional', activity: 'Everyone works on their own thing. Share at the end if you want.', size: '5 to 10 people', bring: ['Anything you like to make'], expect: ['Quick hello in chat.', '45 quiet minutes.', 'Optional show-and-tell.'], leave: 'Just leave the room. No goodbye needed.', access: ['Camera optional', 'Chat-only welcome'], attendees: ['Ari L.', 'Kai M.', 'Rosa T.', 'Bea N.'] },
  { id: 'e-gaming', groupId: 'gaming', title: 'Cozy co-op night', date: addDays(5), time: '20:00', end: '22:00', locType: 'Online', where: 'Group voice room, text channel available', activity: 'Cozy co-op games. The host picks something easy to join.', size: '4 to 8 people', bring: ['A controller or keyboard'], expect: ['Game is posted the day before.', 'Teams are picked randomly.'], leave: 'Type "heading off" in chat.', access: ['Text-only players welcome'], attendees: ['Nico B.', 'Sana H.', 'Wren J.'] },
  { id: 'e-adulting', groupId: 'adulting', title: 'Budget basics swap', date: addDays(7), time: '18:00', end: '19:00', locType: 'Online', where: 'Text thread in this group', activity: 'Share one tool or habit that helps with money. Questions welcome.', size: 'Any size', bring: ['A question, if you have one'], expect: ['A slow text thread over one hour.'], leave: 'Mute the thread whenever you like.', access: ['Text only'], attendees: ['Lena V.', 'Marco D.'] },
  { id: 'e-study', groupId: 'study', title: 'Silent study sprint', date: addDays(1), time: '15:00', end: '16:30', locType: 'Online', where: 'Video room, cameras off is fine', activity: 'Two 40-minute focus blocks with a break.', size: '5 to 12 people', bring: ['Whatever you want to work on'], expect: ['Quick goals in chat.', 'Quiet work.', 'Break in the middle.'], leave: 'Leave any time.', access: ['Camera off is fine'], attendees: ['June O.', 'Sid R.'] },
  { id: 'e-adhd', groupId: 'adhd', title: 'Body-doubling hour', date: addDays(2), time: '11:00', end: '12:00', locType: 'Online', where: 'Video room, cameras optional', activity: 'Work on a task while others do the same.', size: '6 to 15 people', bring: ['One task to start'], expect: ['Say your task in chat.', 'Quiet working time.'], leave: 'Just leave. No goodbye needed.', access: ['Camera optional'], attendees: ['Priya D.', 'Tess G.'] },
];

const t0 = Date.now();
const mins = (m: number) => t0 - m * 60000;
export const SEED_MESSAGES: Record<string, any[]> = {
  coffee: [
    { id: 'm1', user: 'Maya R.', text: 'Morning! I posted Saturday\'s plan. Same corner table as last time.', ts: mins(260), reactions: { '👍': ['Theo K.', 'Ines P.'] } },
    { id: 'm2', user: 'Theo K.', text: 'Thanks. Is it okay if I just read for most of it?', ts: mins(200), reactions: {} },
    { id: 'm3', user: 'Maya R.', text: 'Totally okay. Reading together counts.', ts: mins(190), reactions: { '❤️': ['Theo K.'] }, replyTo: 'm2' },
    { id: 'm4', user: 'Ines P.', text: 'I might be 10 min late. I\'ll message here when I arrive.', ts: mins(45), reactions: {} },
  ],
  creative: [
    { id: 'm1', user: 'Ari L.', text: 'Finished the little moth drawing from last week. Happy with the wings.', ts: mins(400), reactions: { '🙌': ['Kai M.', 'Rosa T.'] } },
    { id: 'm2', user: 'Rosa T.', text: 'Anyone have tips for drawing hands? Mine look like forks.', ts: mins(120), reactions: { '😄': ['Ari L.'] } },
  ],
  gaming: [
    { id: 'm1', user: 'Nico B.', text: 'Co-op night is on. Game will be posted tomorrow.', ts: mins(600), reactions: { '👍': ['Sana H.', 'Leo F.', 'Wren J.'] } },
    { id: 'm2', user: 'Wren J.', text: 'Can I join text-only again?', ts: mins(90), reactions: {} },
    { id: 'm3', user: 'Nico B.', text: 'Always.', ts: mins(80), reactions: { '❤️': ['Wren J.'] }, replyTo: 'm2' },
  ],
  adhd: [
    { id: 'm1', user: 'Priya D.', text: 'Tip that worked for me: I leave my keys inside one shoe by the door.', ts: mins(500), reactions: { '😄': ['Omar A.'], '👍': ['Tess G.'] } },
    { id: 'm2', user: 'Tess G.', text: 'I set two alarms for appointments. One a day before, one an hour before.', ts: mins(70), reactions: {} },
  ],
  adulting: [
    { id: 'm1', user: 'Lena V.', text: 'Today I learned you can ask the pharmacy to text you when a refill is ready.', ts: mins(300), reactions: { '🙌': ['Marco D.'] } },
  ],
  study: [{ id: 'm1', user: 'June O.', text: 'Sprint tomorrow at 3. I\'ll post the room link here.', ts: mins(150), reactions: {} }],
  books: [
    { id: 'm1', user: 'Iris Q.', text: 'This month\'s pick is a quiet sci-fi film. Spoiler thread is pinned.', ts: mins(800), reactions: { '👍': ['Felix N.'] } },
    { id: 'm2', user: 'Zoe A.', text: 'I\'ll be at the watch-along. First time!', ts: mins(60), reactions: { '❤️': ['Iris Q.'] } },
  ],
};
export const DEMO_REPLIES: Record<string, string> = {
  coffee: 'Nice to see you here. Saturday is relaxed, come as you are.',
  creative: 'Welcome! No pressure to share, but we\'d love to see what you make.',
  gaming: 'Hey! Text-only is totally fine on co-op nights.',
  adhd: 'Welcome. Late replies are normal here, so no rush.',
  adulting: 'Welcome! No question is too basic in here.',
  study: 'Hi! Join the sprint any time, cameras off is fine.',
  books: 'Welcome! Have you seen this month\'s pick yet?',
};

export const COMFORT_PREFS = ['I prefer smaller groups.', 'I prefer chatting before meeting.', 'I need time to respond.', 'I prefer quiet environments.', 'Talking is optional.', 'I like knowing the plan in advance.'];

// ---------- Rescue flows ----------
export type Step = { id: string; text: string; detail?: string; help?: string; list?: string[]; options?: { label: string; go: string }[]; go?: string; action?: { label: string; to: string; p?: any }; final?: boolean };
export const RESCUE_FLOWS: Record<string, { title: string; steps: Step[] }> = {
  bus: {
    title: 'Bus canceled',
    steps: [
      { id: 's1', text: 'Your bus was canceled. We can figure out what to do next.', detail: 'Canceled buses happen. There is usually another way to get there.', help: "You don't have to solve everything at once. We'll go one step at a time. Tap Done when you're ready for the next step." },
      { id: 's2', text: 'Find a safe, comfortable spot to stand or sit while you plan.', help: 'A bench at the stop, inside a nearby shop, or anywhere out of the way of traffic works.' },
      { id: 's3', text: 'Check when the next bus on this route is coming.', detail: 'Use your transit app, the sign at the stop, or the transit website.', help: 'Look for the route number on the sign at your stop. Many transit apps show live arrival times. You can also ask a driver or station staff.' },
      { id: 's4', text: 'Will the next bus get you there in time?', options: [{ label: 'Yes, I can wait', go: 's5a' }, { label: "No, it's too late", go: 's5b' }, { label: "I'm not sure", go: 's5c' }] },
      { id: 's5a', text: 'Wait for the next bus. Set a reminder a few minutes before it comes.', help: 'Keep your pass or fare ready so getting on is easier.', go: 's6' },
      { id: 's5b', text: 'Pick another way to get there.', list: ['A different bus or train route', 'A ride from someone you trust', 'A taxi or rideshare, if that works for you', 'Walking, if it is close and safe'], help: 'Your transit app can show other routes. If you are not sure, pick the option that feels most familiar.', go: 's6' },
      { id: 's5c', text: "That's okay. Ask someone who works for transit, or check the app again in a few minutes.", help: 'You can say "Excuse me, my bus was canceled. What is the best way to get to [place]?"', go: 's6' },
      { id: 's6', text: "Let the person you're meeting know you might be late.", action: { label: 'Help me write the message', to: 'say', p: { preset: 'late' } }, help: "A short message is enough. You don't have to explain more than you want to." },
      { id: 'done', text: 'You have a new plan.', detail: 'You worked through a change in plans, one step at a time.', final: true },
    ],
  },
  lost: {
    title: 'Lost or confused',
    steps: [
      { id: 'l1', text: 'Stop somewhere safe and out of the way.', help: 'A wall, a bench, or inside a shop or station works.' },
      { id: 'l2', text: 'Open a maps app to see where you are.', detail: 'The blue dot shows your location. You can turn your phone until the map matches the street.', help: 'If you do not have a maps app, look for a street sign or a building name.' },
      { id: 'l3', text: 'Look for a sign, landmark, or street name you recognize.', help: 'Bus stop names and big stores are easy landmarks to share with others.' },
      { id: 'l4', text: 'If you want help, ask someone who works nearby, like a store or station worker.', action: { label: 'Help me ask for directions', to: 'say', p: { preset: 'directions' } }, help: 'People in uniform or behind a counter are usually good to ask.' },
      { id: 'l5', text: 'Tell a trusted person where you are.', action: { label: 'Contact a trusted person', to: 'trusted', p: { preset: 'lost' } } },
      { id: 'done', text: 'You know where you are and what to do next.', final: true },
    ],
  },
  quiet: {
    title: 'Find a quieter place',
    steps: [
      { id: 'q1', text: 'Look for the nearest place with fewer people.', detail: 'Restrooms, stairwells, a parked car, or outside the building often work.', help: 'You can say "Excuse me, I need a minute" and step away. You don\'t need to explain.' },
      { id: 'q2', text: 'If you have headphones or sunglasses, now is a good time to use them.' },
      { id: 'q3', text: 'Stay there as long as you need.', help: 'There is no timer. Come back to Rumi when you are ready.' },
      { id: 'done', text: 'You found some space.', final: true },
    ],
  },
  notice: {
    title: 'Notice what is around me',
    steps: [
      { id: 'n1', text: 'Name 5 things you can see.', help: 'Any five things. A cup, a light, a door. Say them in your head or out loud.' },
      { id: 'n2', text: 'Name 4 things you can feel.', help: 'Your feet on the ground, your clothes, a chair, the air.' },
      { id: 'n3', text: 'Name 3 things you can hear.' },
      { id: 'n4', text: 'Name 2 things you can smell, or 2 smells you like.' },
      { id: 'n5', text: 'Name 1 thing you could do next. Small is fine.' },
      { id: 'done', text: 'Done. You can stop here or pick another option.', final: true },
    ],
  },
};

export const SAY_WHO = [
  { id: 'reception', label: 'A receptionist' },
  { id: 'staff', label: 'A driver or staff member' },
  { id: 'friend', label: 'A friend or family member' },
  { id: 'other', label: 'Someone else' },
];
export const SAY_GOALS: Record<string, { id: string; label: string }[]> = {
  reception: [{ id: 'book', label: 'Make an appointment' }, { id: 'reschedule', label: 'Change an appointment' }, { id: 'cancel', label: 'Cancel an appointment' }, { id: 'accom', label: 'Ask for an accommodation' }, { id: 'question', label: 'Ask a question' }],
  staff: [{ id: 'directions', label: 'Ask for directions' }, { id: 'stop', label: 'Ask which stop to use' }, { id: 'help', label: 'Ask for help' }],
  friend: [{ id: 'late', label: "Say I'm running late" }, { id: 'cancelplan', label: 'Cancel or change plans' }, { id: 'needhelp', label: 'Ask for help' }],
  other: [{ id: 'repeat', label: 'Ask them to repeat' }, { id: 'time', label: 'Ask for more time' }, { id: 'help', label: 'Ask for help' }],
};
export function sayTemplate(goal: string, name: string, extra: any = {}) {
  const me = name || '[your name]';
  const d = extra.date || '[date]';
  const T: Record<string, string> = {
    book: `Hi, my name is ${me}. I'd like to make an appointment, please. What times do you have available?`,
    reschedule: `Hi, my name is ${me}. I have an appointment on ${d}. I need to change it. What other times do you have?`,
    cancel: `Hi, my name is ${me}. I have an appointment on ${d}, and I need to cancel it. Is there anything else I need to do?`,
    accom: `Hi, my name is ${me}. I have an appointment coming up. Could I ask for a quiet place to wait? It would really help me.`,
    question: `Hi, my name is ${me}. I have a question about my appointment. Do you have a minute?`,
    directions: `Excuse me, I'm a little lost. Could you help me get to ${extra.place || '[place]'}?`,
    stop: `Excuse me, which stop should I use to get to ${extra.place || '[place]'}?`,
    help: `Excuse me, could you help me for a moment? I'm not sure what to do next.`,
    late: `Hi, my bus was canceled. I'm finding another way there and may be about 20 minutes late. I'll message you when I'm on my way.`,
    cancelplan: `Hi, I'm sorry, I can't make it today after all. Could we pick another time?`,
    needhelp: `Hi, could you help me with something? I'm having a hard time figuring out what to do next.`,
    repeat: `Sorry, could you say that again a little more slowly?`,
    time: `Could you give me a moment to think? I want to give you a good answer.`,
  };
  return T[goal] || T.help;
}

// ---------- Start With Me (deterministic step library) ----------
export function breakdown(task: string): string[] {
  const t = (task || '').toLowerCase();
  if (has(t, ['clean', 'tidy', 'room', 'declutter'])) return ['Pick one small area to start, like your desk or your bed.', 'Get a bag for trash and put any trash in it.', 'Put clothes in the laundry basket or back in drawers.', 'Gather cups and dishes to take to the kitchen.', 'Put five things back where they belong.', 'Take out the trash and the dishes.', 'Look around. Stop here, or pick one more area.'];
  if (has(t, ['laundry', 'wash clothes'])) return ['Gather dirty clothes into one basket.', 'Sort out anything that needs special care.', 'Put one load in the machine with detergent and start it.', 'Set a reminder for when it finishes.', 'Move clothes to the dryer or a drying rack.', 'Fold or hang them when they are dry.', 'Put them away.'];
  if (has(t, ['dish', 'kitchen'])) return ['Clear space next to the sink.', 'Fill the sink or start with the dishwasher.', 'Wash cups and glasses first.', 'Then plates and bowls.', 'Then pots and pans.', 'Wipe the counter.'];
  if (has(t, ['email', 'reply', 'message', 'text'])) return ['Open the message you need to answer.', 'Read it once. Note the one thing they are asking.', 'Write one sentence that answers that thing.', 'Add a greeting and a sign-off.', 'Read it once more, then send it.'];
  if (has(t, ['grocer', 'shopping', 'store'])) return ['Check what you already have.', 'Write a short list of what you need.', 'Pick a store and a time to go.', 'Bring bags and your list.', 'Get the items on your list.', 'Put the food away when you get home.'];
  if (has(t, ['study', 'homework', 'essay', 'assignment', 'exam'])) return ['Get your materials in one place.', 'Pick one small part, like one page or one question.', 'Work on just that part.', 'Take a short break.', 'Pick the next small part.', 'Write down where you stopped for next time.'];
  if (has(t, ['call', 'phone'])) return ['Write down why you are calling, in one sentence.', 'Write down any details they may ask for, like your date of birth.', 'Find a quiet spot.', 'Dial the number. You can read from your notes.', 'Write down what they tell you.'];
  if (has(t, ['shower', 'ready', 'dress'])) return ['Get your towel and clothes ready.', 'Start the water and wait until it feels right.', 'Shower or wash up.', 'Dry off and get dressed.'];
  return ['Get what you need for this in one place.', 'Do the very first small part. Just that.', 'Do the next small part.', 'Check what is left.', 'Finish up and put things away.'];
}

export const ENCOURAGEMENT = [
  'Small steps count. You do not have to do everything today.',
  'Rest is part of the plan, too.',
  'You can change your plans and still be on track.',
  'Doing one thing is better than waiting for the perfect time.',
];
