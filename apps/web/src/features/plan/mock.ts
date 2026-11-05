import type { z } from 'zod';
import type { PlanRequest, PlanReply } from '../shared/schemas';
/** Deterministic demo behavior. Never reuse a headache fixture for unrelated user input. */
export function mockPlan(r?: z.infer<typeof PlanRequest>): z.infer<typeof PlanReply> {
  const raw = r?.rawText.trim() || 'I keep getting headaches, my mom always talks for me, I forget things.';
  const chunks = raw.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const mainConcern = (chunks[0] || raw).slice(0, 300);
  return { plan: { id: 'plan-demo', title: 'Visit plan', createdAt: '2026-11-05T09:00:00.000Z', mainConcern,
    symptomsInMyWords: [], items: [
      { id: 'q1', text: mainConcern.slice(0, 200), kind: 'concern', source: 'user', enabled: true },
      { id: 'q2', text: 'I want to ask what I should do next.', kind: 'question', source: 'suggested', enabled: false },
      { id: 'q3', text: 'Please give me instructions in writing.', kind: 'accommodation', source: 'suggested', enabled: false },
    ] } };
}
