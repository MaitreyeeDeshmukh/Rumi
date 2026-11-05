import type { z } from 'zod';
import type { PracticeRequest, PracticeReply } from '../shared/schemas';
import { isVerbatim } from '../plan/keepSupportedSymptoms';
const OPEN = { problem: 'Hi. What brings you in today?', questions: 'Hi. Do you have any questions for me?',
  needs: 'Hi. Is there anything that would make this visit easier for you?',
  next_steps: 'This is a pretend task: bring your notes. What is the next step?', whole: 'Hi. What brings you in today?' };
export function mockPractice(r: z.infer<typeof PracticeRequest>): z.infer<typeof PracticeReply> {
  const mine = r.turns.filter((t) => t.role === 'me');
  const latest = mine.at(-1)?.text ?? '';
  const clinicianTurns = r.turns.filter((t) => t.role === 'clinician').length;
  const stuck = /not sure|do not know|don't know/i.test(latest);
  const ending = (!stuck && mine.length >= (r.focus === 'whole' ? 4 : r.focus === 'problem' ? 2 : 1)) || clinicianTurns >= 7;
  const clinicianSay = ending ? 'Thank you for practicing. You can end the practice now.' : !mine.length ? OPEN[r.focus]
    : stuck ? 'You can take your time. You can also choose Help me say it.'
    : r.focus === 'whole' && mine.length === 3 ? 'Do you have any questions for me?' : 'When does that happen?';
  return { clinicianSay, isLastTurn: ending,
    coveredItemIds: r.plan.items.filter((i) => i.enabled && isVerbatim(i.text, latest)).map((i) => i.id) };
}
