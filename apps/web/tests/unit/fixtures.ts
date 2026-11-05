// Synthetic data only.
import type { PersonaFact, Recap, RumiState, VisitPlan } from '@/features/shared/types';
import { defaultState } from '@/lib/storage';

export const plan = (): VisitPlan => ({
  id: 'plan1', title: 'Headaches', createdAt: '2026-11-05T10:00:00Z',
  mainConcern: 'I keep getting headaches',
  symptomsInMyWords: ['pounding behind my eyes', 'worse at school'],
  items: [
    { id: 'c1', text: 'My head hurts most days.', kind: 'concern', source: 'user', enabled: true },
    { id: 'q1', text: 'I want to ask why I get these headaches.', kind: 'question', source: 'user', enabled: true },
    { id: 'q2', text: 'I want to ask if screens make it worse.', kind: 'question', source: 'suggested', enabled: false },
    { id: 'q3', text: 'I want to ask what I can do at school.', kind: 'question', source: 'user', enabled: true },
    { id: 'q4', text: 'I want to ask when to come back.', kind: 'question', source: 'user', enabled: true },
    { id: 'a1', text: 'I need the lights lower.', kind: 'accommodation', source: 'user', enabled: true },
  ],
});

export const fact = (key: string, kind: PersonaFact['kind'] = 'support_pref'): PersonaFact =>
  ({ id: `${kind}:${key}`, kind, key, text: '…', createdAt: '' });

export const recap = (): Recap => ({
  id: 'r1', planId: 'plan1', createdAt: '', isSample: true, isSavedFallback: false, mySpeaker: 'B',
  transcript: [{ id: 'l1', speaker: 'A', text: 'Tell me about the headaches.' }],
  items: [
    { section: 'discussed', text: 'Headaches most days for a month.', evidence: ['l1'] },
    { section: 'instructions', text: 'Drink more water.', evidence: ['l1'] },
    { section: 'next_steps', text: 'Come back in two weeks.', evidence: ['l1'] },
  ],
  unconfirmed: [],
  planStatus: [
    { itemId: 'q1', status: 'asked_by_me', evidence: ['l1'] },
    { itemId: 'q3', status: 'asked_by_other', evidence: ['l1'] },
    { itemId: 'q4', status: 'not_asked', evidence: [] },
    { itemId: 'a1', status: 'unclear', evidence: [] },
    { itemId: 'q2', status: 'asked_by_me', evidence: ['l1'] }, // disabled item: must not appear
  ],
});

export const stateWith = (patch: Partial<RumiState>): RumiState => ({ ...defaultState(), ...patch });
