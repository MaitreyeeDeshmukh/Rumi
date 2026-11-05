import type { z } from 'zod';
import type { RecapReply } from '../features/shared/schemas';
import type { VisitPlan, Speaker } from '../features/shared/types';
import { SAMPLE_VISIT } from './sampleVisit';
export const DEMO_PLAN: VisitPlan = {
  id: 'plan-demo', title: 'Visit plan', createdAt: '2026-11-05T09:00:00.000Z',
  mainConcern: 'I keep getting headaches', symptomsInMyWords: ['headaches'],
  items: [
    { id: 'q1', text: 'I want to tell you about my headaches.', kind: 'concern', source: 'user', enabled: true },
    { id: 'q2', text: 'I want to ask why I get these headaches.', kind: 'question', source: 'user', enabled: true },
    { id: 'q3', text: 'I want to ask what I should do next.', kind: 'question', source: 'suggested', enabled: true },
    { id: 'q4', text: 'I want to ask if I can have instructions in writing.', kind: 'accommodation', source: 'suggested', enabled: true },
  ],
};
const text = (id: string) => SAMPLE_VISIT.find((l) => l.id === id)!.text;
/** Extractive quotes, not clinical advice. Display the sample label and recap footer. */
export const SAVED_RECAP_REPLY: z.infer<typeof RecapReply> = {
  items: [
    { section: 'discussed', text: text('l2'), evidence: ['l2'] },
    { section: 'discussed', text: text('l6'), evidence: ['l6'] },
    { section: 'instructions', text: text('l9'), evidence: ['l9'] },
    { section: 'instructions', text: 'Bring the diary with you.', evidence: ['l14'] },
    { section: 'medications', text: text('l12'), evidence: ['l12'] },
    { section: 'next_steps', text: 'Please come back in four weeks.', evidence: ['l14'] },
    { section: 'next_steps', text: text('l16'), evidence: ['l16'] },
  ],
  unconfirmed: ['The screen at school comment is unclear in line 13.'],
  planStatus: [
    // Both Sam and Mom describe the concern. Include both; do not erase Sam's participation.
    { itemId: 'q1', status: 'asked_by_me', evidence: ['l4'] },
    { itemId: 'q2', status: 'asked_by_me', evidence: ['l7'] },
    { itemId: 'q3', status: 'not_asked', evidence: [] },
    { itemId: 'q4', status: 'asked_by_me', evidence: ['l10'] },
  ], dropped: 0,
};
export function savedRecapForSpeaker(speaker: Speaker): z.infer<typeof RecapReply> {
  const reply = structuredClone(SAVED_RECAP_REPLY);
  reply.planStatus = reply.planStatus.map((p) => {
    if (p.itemId === 'q1' && speaker === 'C') return { ...p, status: 'asked_by_me', evidence: ['l2'] };
    if (p.status === 'not_asked') return p;
    return { ...p, status: p.evidence.some((id) => SAMPLE_VISIT.find((l) => l.id === id)?.speaker === speaker) ? 'asked_by_me' : 'asked_by_other' };
  });
  return reply;
}
