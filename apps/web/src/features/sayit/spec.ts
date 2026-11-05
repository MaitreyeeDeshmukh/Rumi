import type { z } from 'zod';
import type { TaskSpec } from '../shared/task';
import { SayItRequest, SayItModelOut, SayItReply } from '../shared/schemas';
import { SAYIT_TASK, SAYIT_VERSION, LEVEL_RULE, SCENARIO_CONTEXT } from '../../../prompts/sayit';
import { featureSystem, wrapUserText } from '../../../prompts/shared';
import { lintGuard } from '../../lib/literalLint';
import { newFacts, blanksFrom } from './newFacts';
import { mockSayIt } from './mock';
export const sayItSpec: TaskSpec<z.infer<typeof SayItRequest>, z.infer<typeof SayItModelOut>, z.infer<typeof SayItReply>> = {
  name: 'sayit', promptVersion: SAYIT_VERSION, request: SayItRequest, modelOut: SayItModelOut, reply: SayItReply,
  userStrings: (r) => Object.fromEntries([['companionName', r.companionName], ['mainConcern', r.mainConcern ?? ''],
    ['clinicianQuestion', r.clinicianQuestion ?? ''], ...(r.symptomsInMyWords ?? []).map((s, n) => [`symptom_${n}`, s])]),
  build: (r, safe, memory) => ({
    system: featureSystem(safe, memory, SAYIT_TASK.replace('{{levelRule}}', LEVEL_RULE[r.level]).replace('{{context}}', r.scenario ? SCENARIO_CONTEXT[r.scenario] : 'See the clinicianQuestion data.').replace('{{facts}}', 'See the wrapped facts below.')),
    user: [wrapUserText('clinicianQuestion', safe.clinicianQuestion), wrapUserText('mainConcern', safe.mainConcern),
      ...(r.symptomsInMyWords ?? []).map((_, n) => wrapUserText(`symptom_${n}`, safe[`symptom_${n}`]))].join('\n'),
  }),
  validate: (r, o) => {
    const hard: string[] = []; const soft = lintGuard([o.script]);
    if (r.level > 1 && newFacts(o.script, [r.mainConcern, ...(r.symptomsInMyWords ?? [])].filter(Boolean).join(' ')).length) hard.push('new_fact');
    if (r.level === 1 && !o.script.includes('?')) soft.push('level1_no_question');
    if (r.level === 1 && /(?:^|[.!?]\s+)I\s/.test(o.script)) hard.push('level1_statement');
    if (r.level === 3 && blanksFrom(o.script).length) hard.push('level3_has_blanks');
    if (/\bjust\b/i.test(o.script)) soft.push('minimizing_language');
    if (blanksFrom(o.script).length > 6) hard.push('too_many_blanks');
    return { hard, soft };
  },
  finalize: (_r, o) => ({ script: o.script, blanks: blanksFrom(o.script) }),
  adviceGuard: true, useMemory: true, temperature: 0.3, maxOutputTokens: 300, mock: mockSayIt,
};
