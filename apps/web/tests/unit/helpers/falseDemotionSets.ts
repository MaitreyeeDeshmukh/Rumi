/**
 * Faithful answers a real model would plausibly give, written by the lane builder (not taken from any roaster list),
 * used to measure FALSE demotion: how often a correct answer is wrongly refused by the hard checks. Each set has at least 30 entries.
 * `mustBlock` lists are the other side: answers that assert something the user never gave. They must stay blocked.
 */

export interface EchoCase {
  level: 2 | 3;
  question: string;
  script: string;
}
const NEUTRAL3 = "I am not sure how to answer this. Can you ask me one question at a time?";
const TOPICS: [question: string, topicBlank: string, yesNo: string][] = [
  ["Do you smoke?", "smoking", "I [do or do not] smoke."],
  ["Do you drink alcohol?", "drinking alcohol", "I [do or do not] drink alcohol."],
  ["Do you have any allergies?", "allergies", "I [do or do not] have allergies."],
  ["Could you be pregnant?", "being pregnant", "I [am or am not] pregnant."],
  ["Do you take any medicine?", "medicine", "I [do or do not] take medicine."],
  ["How do you sleep at night?", "sleeping", "I [do or do not] sleep well."],
  ["Do you feel sad or worried?", "feeling sad", "I [do or do not] feel sad."],
  ["Have you had any surgery?", "surgery", "I [have or have not] had surgery."],
  ["Do you have asthma?", "asthma", "I [do or do not] have asthma."],
  ["Does diabetes run in your family?", "diabetes", "I [do or do not] know about diabetes."],
  ["Do you feel stressed at school?", "stress", "I [do or do not] feel stressed."],
  ["Do you use any drugs?", "drugs", "I [do or do not] use drugs."],
  ["Do you have chest pain?", "chest pain", "I [do or do not] have chest pain."],
  ["Do you feel dizzy?", "feeling dizzy", "I [do or do not] feel dizzy."],
  ["Do you feel nauseous?", "feeling nauseous", "I [do or do not] feel nauseous."],
];
export const ECHO_OK: EchoCase[] = [
  ...TOPICS.map(([question, , yesNo]) => ({ level: 2 as const, question, script: yesNo })),
  ...TOPICS.map(([question, topic]) => ({ level: 2 as const, question, script: `For this question, I want to say [what to say about ${topic}].` })),
  ...TOPICS.slice(0, 6).map(([question]) => ({ level: 3 as const, question, script: NEUTRAL3 })),
];

/** Assertions the user never made, even though the clinician asked about the topic. */
export const ECHO_MUST_BLOCK: EchoCase[] = [
  { level: 2, question: "Do you smoke?", script: "I smoke." },
  { level: 2, question: "Do you smoke?", script: "I smoke [how often]." },
  { level: 2, question: "Do you drink alcohol?", script: "I drink alcohol on weekends." },
  { level: 3, question: "Could you be pregnant?", script: "I am pregnant." },
  { level: 2, question: "Do you take any medicine?", script: "I take medicine every day." },
  { level: 2, question: "Have you had any surgery?", script: "I had surgery last year [which operation]." },
  { level: 3, question: "Do you feel sad or worried?", script: "I feel sad." },
  { level: 3, question: "Do you have asthma?", script: "I have asthma." },
  { level: 2, question: "Do you feel dizzy?", script: "I am dizzy [how often]." },
  { level: 2, question: "Do you use any drugs?", script: "I use drugs sometimes." },
  { level: 2, question: "Do you smoke?", script: "I [do or do not] smoke. I also drink alcohol." },
  { level: 3, question: "Do you have chest pain?", script: "I have chest pain." },
];

/** Time and frequency questions the pretend clinician naturally asks. The user said: "My head hurts a lot." */
export const TIME_QUESTIONS: string[] = [
  "How many days a week do you get the headaches?", "Do they happen every day?", "Did they start last week?", "Have they lasted a few hours?", "Do you get them daily?",
  "Is it weekly or monthly?", "Did it begin a month ago?", "Do they come once a day?", "Is it worse every morning?", "Did this happen last year too?",
  "How many times a day does it come?", "Has it been going on for two weeks?", "Did it start yesterday?", "Do you get it every other day?", "Is it there all day or just a few hours?",
  "How long does each one last, an hour or more?", "Does it come twice a week?", "Did it start a week ago?", "Has it been three days?", "Is it every night?",
  "Do they happen every week?", "Did it begin last month?", "How many hours does it last?", "Does it happen every afternoon?", "Did it get worse last night?",
  "Has it happened once or twice?", "Do you get it every few days?", "How many minutes does it last?", "Did it start a year ago?", "Does it come every evening?",
  "Has it been there for a month?", "Do you get it about once a week?", "Does it last for 10 minutes?", "Is it a daily thing?",
];

/** [raw text, main concern, symptom, user item]: natural paraphrases of what the user typed. */
export const PLAN_PARAPHRASES: [raw: string, concern: string, symptom: string, item: string][] = [
  ["My head hurts every afternoon. I want to know why.", "I get headaches every afternoon", "headaches", "I want to tell you that my head hurts every afternoon."],
  ["I get angry at school and I do not know why.", "I feel anger at school", "anger", "I want to say that I get angry at school."],
  ["My ankle is swollen after soccer.", "My ankle swelling after soccer", "swelling in my ankle", "I want to tell you my ankle is swollen after soccer."],
  ["My tummy hurts after lunch.", "My stomach hurts after lunch", "stomach pain", "I want to tell you my tummy hurts after lunch."],
  ["I throw up in the mornings.", "I vomit in the mornings", "vomiting", "I want to tell you I throw up in the mornings."],
  ["I feel really tired all the time.", "I feel exhausted all the time", "tiredness", "I want to say that I feel tired all the time."],
  ["I get dizzy when I stand up.", "I feel dizziness when I stand up", "dizziness", "I want to tell you I get dizzy when I stand up."],
  ["I slept badly all week.", "I am not sleeping well", "sleeping badly", "I want to tell you I slept badly all week."],
  ["I keep coughing at night.", "I have a cough at night", "cough", "I want to tell you I keep coughing at night."],
  ["My eyes feel sore when I read.", "My eyes get sore when I read", "sore eyes", "I want to say that my eyes feel sore when I read."],
  ["I have a rash on my arm that itches.", "I have an itchy rash on my arm", "rash", "I want to tell you about the rash on my arm."],
  ["My knee clicks when I walk upstairs.", "My knee clicks on stairs", "knee clicking", "I want to tell you my knee clicks when I walk upstairs."],
  ["I get really nervous before tests.", "I get anxious before tests", "nervous", "I want to tell you I get very nervous before tests."],
  ["Loud noises hurt my ears.", "Loud sounds hurt my ears", "sensitive ears", "I want to say that loud noises hurt my ears."],
  ["I cannot focus in class.", "I have trouble focusing in class", "cannot focus", "I want to tell you I cannot focus in class."],
  ["My back aches after sitting.", "My back hurts when I sit", "back ache", "I want to tell you my back aches after sitting."],
  ["I feel sick after eating.", "I feel nauseous after meals", "feeling sick", "I want to say I feel sick after eating."],
  ["My hands shake when I write.", "My hands shake while writing", "shaky hands", "I want to tell you my hands shake when I write."],
  ["I have a sore throat and a fever.", "I have a sore throat and fever", "sore throat", "I want to tell you I have a sore throat and a fever."],
  ["I get headaches when I look at screens.", "Screens give me headaches", "headaches", "I want to say screens give me headaches."],
  ["I forget things all the time.", "I keep forgetting things", "forgetting things", "I want to tell you I forget things all the time."],
  ["My skin gets dry and cracks.", "My skin is dry and cracking", "dry skin", "I want to tell you my skin gets dry and cracks."],
  ["I feel scared when people touch me.", "I get frightened when touched", "feeling scared", "I want to say I feel scared when people touch me."],
  ["I wake up a lot during the night.", "I wake up often at night", "waking up", "I want to say I wake up a lot during the night."],
  ["My shoulder hurts when I lift my arm.", "My shoulder pain when lifting my arm", "shoulder pain", "I want to tell you my shoulder hurts when I lift my arm."],
  ["I get short of breath on the stairs.", "I get breathless on the stairs", "short of breath", "I want to tell you I get short of breath on the stairs."],
  ["I feel sad most days.", "I feel low most days", "sadness", "I want to say I feel sad most days."],
  ["My teeth hurt when I drink cold water.", "My teeth are sensitive to cold", "tooth pain", "I want to tell you my teeth hurt with cold water."],
  ["I have trouble eating because it hurts to swallow.", "It hurts to swallow", "painful swallowing", "I want to tell you it hurts when I swallow."],
  ["My legs ache after school sports.", "My legs hurt after sport", "aching legs", "I want to say my legs ache after school sports."],
  ["I keep getting colds this winter.", "I get lots of colds", "colds", "I want to tell you I keep getting colds this winter."],
];

/** [clinician question, level 1 hint]: shapes a model can reasonably write. */
export const HINTS: string[] = [
  "What do you want to add? You can start with: It feels ...",
  "What do you want to add? You can start with: It lasts ...",
  "What do you want to add? You can start with: I notice ...",
  "What do you want to add? You can start with: It started ...",
  "What do you want to add? You can start with: It happens ...",
  "What detail do you want to add? You can start with: I am not sure ...",
  "Can you tell me when it started? You can start with: It started ...",
  "How long has it been? You can start with: It has been ...",
  "How often does it happen? You can start with: It happens ...",
  "What does it feel like? You can start with: It feels ...",
  "Where do you feel it? You can start with: I feel it ...",
  "What do you want to add? You can start with: I think ...",
  "What do you want to add? You can start with: It seems ...",
  "When do you notice it? You can start with: I notice it ...",
  "Do you want to say how long? You can start with: It lasts ...",
  "What else do you want to say? You can start with: Also ...",
  "How strong is it? You can start with: It is ...",
  "Can you say more about the headaches? You can start with: They come ...",
  "What happens before it starts? You can start with: Before it ...",
  "What do you want the clinician to know? You can start with: I want ...",
  "Does it come and go? You can start with: It comes ...",
  "When did it begin? You can start with: It began ...",
  "How many days has it lasted? You can start with: It has lasted ...",
  "What do you do when it starts? You can start with: When it starts ...",
  "Is there anything else? You can start with: Also, I ...",
  "What do you want to say first? You can start with: First ...",
  "Can you describe it? You can start with: It is like ...",
  "How does it come? You can start with: It comes ...",
  "What do you want to ask? You can start with: I want to ask ...",
  "What do you notice? You can start with: I feel ...",
  "What happened? You can start with: It happened ...",
  "What do you want to say about the headaches? You can start with: My headaches ...",
];
