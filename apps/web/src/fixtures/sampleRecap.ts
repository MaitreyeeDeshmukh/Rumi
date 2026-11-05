/**
 * The saved recap of SAMPLE_VISIT (mySpeaker B, plan DEMO_PLAN). Shown as "Saved example (live AI unavailable)."
 * It must pass verifyEvidence unchanged: a test proves it.
 */
import type { RecapReplyT } from "@/features/shared/schemas";

export const SAVED_RECAP_REPLY: RecapReplyT = {
  items: [
    { section: "discussed", text: "Headaches most afternoons for about three weeks.", evidence: ["l2"] },
    { section: "discussed", text: "Lying down in a dark room helps a little.", evidence: ["l6"] },
    { section: "instructions", text: "Keep a headache diary for two weeks. Write down when it starts and how strong it is.", evidence: ["l9"] },
    { section: "instructions", text: "Bring the diary to the next visit.", evidence: ["l14"] },
    { section: "medications", text: "Ibuprofen: take if needed. Follow the package directions.", evidence: ["l12"] },
    { section: "next_steps", text: "Come back in four weeks.", evidence: ["l14"] },
    { section: "next_steps", text: "Book the follow-up at the front desk.", evidence: ["l16"] },
  ],
  unconfirmed: ["I could not confirm this: I think the screen at school is [unclear] for him."],
  planStatus: [
    { itemId: "q1", status: "asked_by_other", evidence: ["l2"] },
    { itemId: "q2", status: "asked_by_me", evidence: ["l7"] },
    { itemId: "q3", status: "not_asked", evidence: [] },
    { itemId: "q4", status: "asked_by_me", evidence: ["l10"] },
  ],
  dropped: 0,
};
