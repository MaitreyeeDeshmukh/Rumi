import type { z } from 'zod';
import type { TaskSpec } from '../shared/task';
import { PlanRequest, PlanModelOut, PlanReply } from '../shared/schemas';
import { PLAN_TASK, PLAN_VERSION } from '../../../prompts/plan';
import { featureSystem, wrapUserText } from '../../../prompts/shared';
import { lintGuard } from '../../lib/literalLint';
import { isVerbatim, keepSupportedSymptoms } from './keepSupportedSymptoms';
import { mockPlan } from './mock';
export const GENERIC_SUGGESTIONS = [
  'I want to ask what I should do next.',
  'I want to ask if I can have instructions in writing.',
  'Please give me instructions in writing.',
  'Please give me time to answer.',
  'Please ask one question at a time.',
];
export const planSpec: TaskSpec<z.infer<typeof PlanRequest>, z.infer<typeof PlanModelOut>, z.infer<typeof PlanReply>> = {
  name: 'plan', promptVersion: PLAN_VERSION, request: PlanRequest, modelOut: PlanModelOut, reply: PlanReply,
  userStrings: (r) => ({ rawText: r.rawText, companionName: r.companionName }),
  build: (_r, safe, memory) => ({ system: featureSystem(safe, memory, PLAN_TASK), user: wrapUserText('rawText', safe.rawText) }),
  validate: (r, o) => {
    const hard: string[] = [];
    if (!isVerbatim(o.mainConcern, r.rawText)) hard.push('main_concern_not_from_user');
    if (!o.items.some((i) => i.source === 'user')) hard.push('no_user_items');
    if (o.symptomsInMyWords.some((s) => !isVerbatim(s, r.rawText))) hard.push('unsupported_symptom');
    if (o.items.some((i) => i.source === 'user' && !isVerbatim(i.text, r.rawText))) hard.push('user_item_not_verbatim');
    if (o.items.some((i) => i.source === 'suggested' && !GENERIC_SUGGESTIONS.includes(i.text))) hard.push('specific_suggestion');
    return { hard, soft: lintGuard(o.items.filter((i) => i.source === 'suggested').map((i) => i.text)) };
  },
  finalize: (r, o) => ({ plan: { id: crypto.randomUUID(), title: 'Visit plan', createdAt: new Date().toISOString(),
    mainConcern: o.mainConcern, symptomsInMyWords: keepSupportedSymptoms(r.rawText, o.symptomsInMyWords),
    items: [...o.items.filter((i) => i.source === 'user'), ...o.items.filter((i) => i.source === 'suggested').slice(0, 2)]
      .map((i, n) => ({ ...i, id: `q${n + 1}`, enabled: i.source === 'user' })) } }),
  adviceGuard: true, useMemory: true, temperature: 0.2, maxOutputTokens: 600, mock: mockPlan,
};
