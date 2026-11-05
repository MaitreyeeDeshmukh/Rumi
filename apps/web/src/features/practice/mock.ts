import { enabledItems } from "@/features/practice/labels";
import type { PracticeReplyT, PracticeRequestT } from "@/features/shared/schemas";
import { CLOSING_LINE } from "../../../prompts/persona";

/** MOCK_AI practice: a five-turn visit about headaches, indexed by how many times the user has spoken. */
const LINES = [
  "Hi. What brings you in today?",
  "How often do the headaches happen?",
  "What makes them better or worse?",
  "Do you have any questions for me?",
  CLOSING_LINE,
] as const;

export function practiceMock(r: PracticeRequestT): PracticeReplyT {
  const spoken = r.turns.filter((t) => t.role === "me").length;
  const at = Math.min(spoken, LINES.length - 1);
  const ids = enabledItems(r.plan).map((i) => i.id);
  // The first item counts as covered once the user has answered, the second after three answers.
  return { clinicianSay: LINES[at], coveredItemIds: ids.slice(0, spoken >= 3 ? 2 : spoken >= 1 ? 1 : 0), isLastTurn: at === LINES.length - 1 };
}
