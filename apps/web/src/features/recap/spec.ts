import type { z } from 'zod';
import type { TaskSpec } from '../shared/task';
import { RecapRequest, RecapModelOut, RecapReply } from '../shared/schemas';
import { RECAP_TASK, RECAP_VERSION } from '../../../prompts/recap';
import { featureSystem, wrapUserText } from '../../../prompts/shared';
import { lintGuard } from '../../lib/literalLint';
import { enabledItems } from '../practice/labels';
import { verifyEvidence } from './verifyEvidence';
import { isSampleVisit, mockRecap } from './mock';
export const recapSpec: TaskSpec<z.infer<typeof RecapRequest>, z.infer<typeof RecapModelOut>, z.infer<typeof RecapReply>> = {
  name: 'recap', promptVersion: RECAP_VERSION, request: RecapRequest, modelOut: RecapModelOut, reply: RecapReply,
  userStrings: (r) => Object.fromEntries([...r.lines.map((l, n) => [`line_${n}`, l.text]),
    ...(r.plan ? enabledItems(r.plan).map((i, n) => [`plan_${n}`, i.text]) : [])]),
  build: (r, safe) => ({ system: featureSystem({}, '', RECAP_TASK.replaceAll('{{mySpeaker}}', r.mySpeaker)),
    user: [...r.lines.map((l, n) => `L${n + 1} [${l.speaker}]: ${wrapUserText(`line_${n}`, safe[`line_${n}`])}`),
      ...(r.plan ? enabledItems(r.plan).map((i, n) => `${i.label}: ${wrapUserText(`plan_${n}`, safe[`plan_${n}`])}`) : [])].join('\n') }),
  validate: (r, o) => {
    const labels = new Set(r.plan ? enabledItems(r.plan).map((i) => i.label) : []);
    const hard: string[] = [];
    if (!isSampleVisit(r.lines)) hard.push('sample_visit_only');
    if (new Set(r.lines.map((l) => l.id)).size !== r.lines.length) hard.push('duplicate_line_ids');
    if (!o.items.length && !o.unconfirmed.length) hard.push('empty');
    if (o.planStatus.some((p) => !labels.has(p.itemId))) hard.push('unknown_plan_label');
    return { hard, soft: lintGuard(o.items.map((i) => i.text)) };
  },
  finalize: (r, o) => {
    const labels = new Map((r.plan ? enabledItems(r.plan) : []).map((i) => [i.label, i.id]));
    const verified = verifyEvidence(r.lines.map((l, n) => ({ ...l, id: `L${n + 1}` })), o, r.mySpeaker);
    const mapEvidence = (ids: string[]) => ids.flatMap((id) => {
      const index = Number(id.slice(1)) - 1; return r.lines[index] ? [r.lines[index].id] : [];
    });
    return { ...verified, items: verified.items.map((i) => ({ ...i, evidence: mapEvidence(i.evidence) })),
      planStatus: verified.planStatus.flatMap((p) => labels.has(p.itemId) ? [{ ...p, itemId: labels.get(p.itemId)!, evidence: mapEvidence(p.evidence) }] : []) };
  },
  adviceGuard: false, useMemory: false, temperature: 0.1, maxOutputTokens: 1500, mock: mockRecap,
};
