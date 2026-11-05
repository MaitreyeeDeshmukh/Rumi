import type { z } from 'zod';
import type { TaskSpec } from '../shared/task';
import { PracticeRequest, PracticeModelOut, PracticeReply } from '../shared/schemas';
import { PRACTICE_TASK, PRACTICE_VERSION } from '../../../prompts/practice';
import { featureSystem, wrapUserText } from '../../../prompts/shared';
import { lintGuard } from '../../lib/literalLint';
import { enabledItems } from './labels';
import { mockPractice } from './mock';
export const practiceSpec: TaskSpec<z.infer<typeof PracticeRequest>, z.infer<typeof PracticeModelOut>, z.infer<typeof PracticeReply>> = {
  name: 'practice', promptVersion: PRACTICE_VERSION, request: PracticeRequest, modelOut: PracticeModelOut, reply: PracticeReply,
  userStrings: (r) => Object.fromEntries([['mainConcern', r.plan.mainConcern], ['companionName', r.companionName],
    ...enabledItems(r.plan).map((i) => [`item_${i.label}`, i.text]), ...r.turns.map((t, n) => [`turn_${n}`, t.text])]),
  build: (r, safe, memory) => ({ system: featureSystem(safe, memory, PRACTICE_TASK.replace('{{focus}}', r.focus)),
    user: [wrapUserText('mainConcern', safe.mainConcern), ...enabledItems(r.plan).map((i) => `${i.label}: ${wrapUserText(`item_${i.label}`, safe[`item_${i.label}`])}`),
      ...r.turns.map((t, n) => `${t.role}: ${wrapUserText(`turn_${n}`, safe[`turn_${n}`])}`)].join('\n') }),
  validate: (r, o) => ({
    hard: o.coveredItemIds.some((id) => !enabledItems(r.plan).some((i) => i.label === id)) ? ['unknown_label'] : [],
    soft: [...lintGuard([o.clinicianSay]), ...((o.clinicianSay.match(/\?/g) ?? []).length > 1 ? ['multi_question'] : [])],
  }),
  finalize: (r, o) => {
    const labels = new Map(enabledItems(r.plan).map((i) => [i.label, i.id]));
    return { clinicianSay: o.clinicianSay, coveredItemIds: [...new Set(o.coveredItemIds.flatMap((id) => labels.has(id) ? [labels.get(id)!] : []))],
      isLastTurn: o.isLastTurn || r.turns.filter((t) => t.role === 'clinician').length >= 7 };
  },
  adviceGuard: true, useMemory: true, temperature: 0.6, maxOutputTokens: 300, mock: mockPractice,
};
