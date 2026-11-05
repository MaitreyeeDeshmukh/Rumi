/**
 * TEMPORARY stand-in for Aakash's `@/fixtures` (SAMPLE_VISIT, DEMO_PLAN, SAVED_RECAP_REPLY)
 * and the per-task mock() replies. All content is made up by the team. Swap in `deps/index.ts`.
 */
import type { TranscriptLine, VisitPlan } from '@/features/shared/types';
import type { z } from 'zod';
import type { RecapReply } from '@/features/shared/schemas';

export const DEMO_PLAN: VisitPlan = {
  id: 'demo-plan',
  title: 'Headaches visit',
  createdAt: '2026-11-05T09:00:00.000Z',
  mainConcern: 'I get headaches most afternoons.',
  symptomsInMyWords: ['my head hurts after lunch', 'bright lights make it worse'],
  items: [
    { id: 'p1', text: 'I get headaches most afternoons.', kind: 'concern', source: 'user', enabled: true },
    { id: 'p2', text: 'Bright lights make it worse.', kind: 'concern', source: 'user', enabled: true },
    { id: 'p3', text: 'What can I do when a headache starts?', kind: 'question', source: 'user', enabled: true },
    { id: 'p4', text: 'Please write down what I should do.', kind: 'accommodation', source: 'suggested', enabled: false },
  ],
};

export const SAMPLE_VISIT: TranscriptLine[] = [
  { id: 'L1', speaker: 'A', text: 'Hi, I am Dr. Rivera. What brings you in today?' },
  { id: 'L2', speaker: 'B', text: 'I get headaches most afternoons.' },
  { id: 'L3', speaker: 'C', text: 'It has been about three weeks. I am her roommate.' },
  { id: 'L4', speaker: 'A', text: 'Does anything make them worse?' },
  { id: 'L5', speaker: 'B', text: 'Bright lights make it worse.' },
  { id: 'L6', speaker: 'A', text: 'Are you drinking water during the day?' },
  { id: 'L7', speaker: 'B', text: 'Not much. Maybe one glass.' },
  { id: 'L8', speaker: 'A', text: 'Please drink a full glass of water with lunch and one in the afternoon.' },
  { id: 'L9', speaker: 'A', text: 'You can take ibuprofen 200 milligrams with food when a headache starts.' },
  { id: 'L10', speaker: 'C', text: 'What should she do if it does not help?' },
  { id: 'L11', speaker: 'A', text: 'Write down each headache on a calendar. Come back in two weeks.' },
  { id: 'L12', speaker: 'B', text: 'Can you write that down for me?' },
  { id: 'L13', speaker: 'A', text: 'Yes. I will print the steps for you.' },
];

export const SAVED_RECAP_REPLY: z.infer<typeof RecapReply> = {
  items: [
    { section: 'discussed', text: 'You have headaches most afternoons.', evidence: ['L2'] },
    { section: 'discussed', text: 'Bright lights make the headaches worse.', evidence: ['L5'] },
    { section: 'instructions', text: 'Drink a full glass of water with lunch and one in the afternoon.', evidence: ['L8'] },
    { section: 'medications', text: 'Ibuprofen 200 milligrams with food when a headache starts.', evidence: ['L9'] },
    { section: 'next_steps', text: 'Write down each headache on a calendar.', evidence: ['L11'] },
    { section: 'next_steps', text: 'Come back in two weeks.', evidence: ['L11'] },
  ],
  unconfirmed: ['How long the headaches have lasted. Only your roommate said this.'],
  planStatus: [
    { itemId: 'p1', status: 'asked_by_me', evidence: ['L2'] },
    { itemId: 'p2', status: 'asked_by_me', evidence: ['L5'] },
    { itemId: 'p3', status: 'asked_by_other', evidence: ['L10'] },
    { itemId: 'p4', status: 'asked_by_me', evidence: ['L12'] },
  ],
  dropped: 0,
};
