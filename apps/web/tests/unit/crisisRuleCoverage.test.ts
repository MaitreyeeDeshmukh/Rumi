import { describe, expect, it } from "vitest";
import { crisisTier } from "@/lib/crisis";

/**
 * One positive and one near-miss for rules that no other test pinned (roast P2-2). The label [Lnnn] is the line of the rule in
 * src/lib/crisis.ts when this file was written; deleting that one rule makes its positive case fail.
 * Positives are worded the way a person would write them, and are chosen so that no other rule also catches them.
 */
interface Case {
  line: string;
  tier: "certain" | "check";
  positive: string[];
  /** Must not reach the tier above. */
  miss: string[];
}

const TIER1: Case[] = [
  // Rule 161 also reads "rather die", but it has an idiom exception ("die of embarrassment"). Rule 163 has none, so it stays a card on purpose:
  // when unsure, show the card. This pins that, and the plain case.
  { line: "L163 would rather be dead", tier: "certain", positive: ["I would rather be dead than go back to that school.", "I'd rather die of embarrassment than sing."], miss: ["I would rather be at home than at work."] },
  { line: "L171 wish I could never be born", tier: "certain", positive: ["I wish I could never be born."], miss: ["I wish I could never be late again."] },
  { line: "L172 wish a bus would hit me", tier: "certain", positive: ["Some days I wish a bus would hit me.", "I hope I get hit by a bus."], miss: ["I hope the bus arrives on time.", "A bus would take me to school."] },
  { line: "L180 want out of this life", tier: "certain", positive: ["I just want out of this life.", "I need to make the pain stop for good."], miss: ["I want out of this contract.", "I need to make the music stop for a minute."] },
  { line: "L185 going to end it", tier: "certain", positive: ["I am going to end it."], miss: ["I am going to end it with my boyfriend."] },
  { line: "L186 end it tonight", tier: "certain", positive: ["I will end it tonight."], miss: ["I will end it with a joke."] },
  { line: "L194 jump off the roof", tier: "certain", positive: ["I might jump off the roof."], miss: ["The kids jump off the diving board."] },
  { line: "L195 step in front of a train", tier: "certain", positive: ["Maybe I should step in front of a train."], miss: ["She stepped in front of the camera."] },
  { line: "L204 drank antifreeze", tier: "certain", positive: ["I drank antifreeze this morning."], miss: ["I drank some orange juice this morning."] },
  { line: "L208 do not want to wake up ever", tier: "certain", positive: ["I don't want to wake up ever."], miss: ["I don't want to wake up early on Monday."] },
  { line: "L215 touched me inappropriately", tier: "certain", positive: ["My uncle touched me inappropriately."], miss: ["The nurse touched me on the shoulder."] },
  { line: "L227 stroke right now", tier: "certain", positive: ["Please help, stroke right now."], miss: ["There is no stroke right now.", "I read about stroke prevention."] },
  { line: "L234 gasping for air", tier: "certain", positive: ["My dad is gasping for air.", "I have shortness of breath right now."], miss: ["I had shortness of breath last week.", "The fish was swimming in the tank."] },
  { line: "L236 cant catch my breath", tier: "certain", positive: ["I can't catch my breath."], miss: ["I can't catch my breath after the stairs."] },
  { line: "L245 switch myself off", tier: "certain", positive: ["I just want to switch myself off."], miss: ["I want to switch my phone off."] },
  { line: "L247 stay asleep forever", tier: "certain", positive: ["I wish I could fall asleep and stay asleep forever."], miss: ["I want to fall asleep and stay asleep through the storm."] },
  { line: "L255 happier if I was not around", tier: "certain", positive: ["Everyone would be happier if I was not around."], miss: ["They would be happier if I was not there."] },
  { line: "L257 wish I could vanish", tier: "certain", positive: ["I wish I could just vanish."], miss: ["I hope the stain will vanish."] },
  { line: "L296 my grandma is choking", tier: "certain", positive: ["My grandmother is choking!"], miss: ["The kids are laughing and playing."] },
  { line: "L315 spanish: not safe, emergency, ambulance", tier: "certain", positive: ["No me siento segura en mi casa.", "Es una emergencia.", "Necesito una ambulancia."], miss: ["Me siento segura en mi casa.", "Necesito una cita con el doctor."] },
];

// Tier 2 rules: a hit sends the text to the classifier and nothing else. Misses are "none".
const TIER2: Case[] = [
  { line: "L321 dead tired", tier: "check", positive: ["I was dead tired after work."], miss: ["I missed the deadline at work."] },
  { line: "L322 killed me", tier: "check", positive: ["That workout killed me."], miss: ["That workout was hard."] },
  { line: "L323 farewell", tier: "check", positive: ["We held a farewell party for Tom."], miss: ["We held a welcome party for Tom."] },
  { line: "L324 self", tier: "check", positive: ["I want to improve my self confidence."], miss: ["I took a selfie at the park."] },
  { line: "L325 all my meds", tier: "check", positive: ["I put all my meds in a box."], miss: ["I put all my books in a box."] },
  { line: "L327 cannot stand", tier: "check", positive: ["I can't stand the noise in the cafeteria."], miss: ["I can't find my keys."] },
  { line: "L331 spanish tier 2", tier: "check", positive: ["Me quiero ir a casa.", "Voy a matar el tiempo en el parque."], miss: ["Quiero comer pan."] },
  { line: "L342 for the record", tier: "check", positive: ["For the record, I only had tea."], miss: ["I only had tea."] },
  { line: "L343 I intend", tier: "check", positive: ["I intend to visit my aunt."], miss: ["I will visit my aunt."] },
];

describe("tier 1 rules that were not pinned: a natural positive and a near-miss each", () => {
  for (const c of TIER1) {
    describe(`[${c.line}]`, () => {
      it.each(c.positive)("shows the card: %j", (s) => {
        expect(crisisTier(s)).toBe("certain");
      });
      it.each(c.miss)("not the card: %j", (s) => {
        expect(crisisTier(s)).not.toBe("certain");
      });
    });
  }
});

describe("tier 2 rules that were not pinned: a natural positive (asks the classifier) and a near-miss (nothing) each", () => {
  for (const c of TIER2) {
    describe(`[${c.line}]`, () => {
      it.each(c.positive)("asks the classifier: %j", (s) => {
        expect(crisisTier(s)).toBe("check");
      });
      it.each(c.miss)("no check at all: %j", (s) => {
        expect(crisisTier(s)).toBe("none");
      });
    });
  }
});
