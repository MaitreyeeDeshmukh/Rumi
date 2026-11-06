// swap when the lane merges (src/fixtures/sampleVisit.ts and sampleRecap.ts). Made-up data from plan 02 step 6.
import type { Recap, TranscriptLine, VisitPlan } from "@/features/shims/types";

export const DEMO_PLAN: VisitPlan = {
  id: "demo-plan",
  title: "Headaches",
  createdAt: "2026-11-01T10:00:00.000Z",
  mainConcern: "I get headaches most afternoons.",
  symptomsInMyWords: ["They feel tight behind my eyes."],
  items: [
    { id: "q1", text: "I have had headaches for about three weeks.", kind: "concern", source: "user", enabled: true },
    { id: "q2", text: "Why do I get these headaches?", kind: "question", source: "user", enabled: true },
    { id: "q3", text: "What should I do next?", kind: "question", source: "suggested", enabled: true },
    { id: "q4", text: "Can I have the instructions in writing?", kind: "accommodation", source: "user", enabled: true },
  ],
};

export const SAMPLE_VISIT: readonly TranscriptLine[] = [
  { id: "l1", speaker: "A", text: "Hi Sam. What brings you in today?" },
  { id: "l2", speaker: "C", text: "He gets headaches most afternoons. It has been about three weeks." },
  { id: "l3", speaker: "A", text: "Sam, what do the headaches feel like?" },
  { id: "l4", speaker: "B", text: "They feel tight behind my eyes. They get worse after class." },
  { id: "l5", speaker: "A", text: "Does anything help?" },
  { id: "l6", speaker: "B", text: "Lying down in a dark room helps a little." },
  { id: "l7", speaker: "B", text: "Why do I get these headaches?" },
  { id: "l8", speaker: "A", text: "Your blood pressure looks normal today. I do not see a clear cause yet." },
  { id: "l9", speaker: "A", text: "Please keep a headache diary for two weeks. Write down when it starts and how strong it is." },
  { id: "l10", speaker: "B", text: "Can I have those instructions in writing?" },
  { id: "l11", speaker: "A", text: "Yes. I will print them before you leave." },
  { id: "l12", speaker: "A", text: "You can take ibuprofen if you need it. Follow the package directions." },
  { id: "l13", speaker: "C", text: "I think the screen at school is [unclear] for him." },
  { id: "l14", speaker: "A", text: "Please come back in four weeks. Bring the diary with you." },
  { id: "l15", speaker: "B", text: "Okay. Thank you." },
  { id: "l16", speaker: "A", text: "Book the follow-up at the front desk on your way out." },
];

export const SAVED_RECAP_REPLY: Pick<Recap, "items" | "unconfirmed" | "planStatus"> & { dropped: number } = {
  items: [
    { section: "discussed", text: "Headaches most afternoons for about three weeks.", evidence: ["l2"] },
    { section: "discussed", text: "Lying down in a dark room helps a little.", evidence: ["l6"] },
    {
      section: "instructions",
      text: "Keep a headache diary for two weeks. Write down when it starts and how strong it is.",
      evidence: ["l9"],
    },
    { section: "instructions", text: "Bring the diary to the next visit.", evidence: ["l14"] },
    { section: "medications", text: "Ibuprofen: take if needed. Follow the package directions.", evidence: ["l12"] },
    { section: "next_steps", text: "Come back in four weeks.", evidence: ["l14"] },
    { section: "next_steps", text: "Book the follow-up at the front desk.", evidence: ["l16"] },
  ],
  unconfirmed: ["I could not confirm this: The screen at school is [unclear] for him."],
  planStatus: [
    { itemId: "q1", status: "asked_by_other", evidence: ["l2"] },
    { itemId: "q2", status: "asked_by_me", evidence: ["l7"] },
    { itemId: "q3", status: "not_asked", evidence: [] },
    { itemId: "q4", status: "asked_by_me", evidence: ["l10"] },
  ],
  dropped: 0,
};

/** What the callApi shim answers for each path (the shapes of ../shared/schemas.ts replies). */
export const SHIM_REPLIES = {
  "/api/plan": { plan: DEMO_PLAN },
  "/api/practice": { clinicianSay: "Hi. What brings you in today?", coveredItemIds: [], isLastTurn: false },
  "/api/sayit": { script: "I have had headaches for about three weeks.", blanks: [] },
  "/api/recap": SAVED_RECAP_REPLY,
} as const;
