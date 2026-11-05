/**
 * Sample visit, made by our team. Synthetic only. Speakers: A = Dr. Lee (clinician), B = Sam (the user), C = Mom.
 * It fits DEMO_PLAN: Mom answers q1, Sam asks q2 and q4, q3 is never asked, one medicine is named, one line is unclear.
 */
import type { TranscriptLine } from "@/features/shared/types";

export const SAMPLE_VISIT_LABEL = "Sample visit, made by our team";

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
