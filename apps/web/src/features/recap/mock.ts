import type { z } from 'zod';
import type { RecapRequest, RecapReply } from '../shared/schemas';
import { SAMPLE_VISIT, DEMO_PLAN, savedRecapForSpeaker } from '../../fixtures';
export function isSampleVisit(lines: z.infer<typeof RecapRequest>['lines']): boolean {
  return lines.length === SAMPLE_VISIT.length && lines.every((l, n) => l.text === SAMPLE_VISIT[n].text && l.speaker === SAMPLE_VISIT[n].speaker);
}
export function mockRecap(r: z.infer<typeof RecapRequest>): z.infer<typeof RecapReply> {
  if (!isSampleVisit(r.lines)) return { items: [], unconfirmed: ['This example only supports the sample visit.'], planStatus: [], dropped: 0 };
  const reply = savedRecapForSpeaker(r.mySpeaker);
  const idMap = new Map(SAMPLE_VISIT.map((l, n) => [l.id, r.lines[n].id]));
  reply.items = reply.items.map((i) => ({ ...i, evidence: i.evidence.map((id) => idMap.get(id)!) }));
  reply.planStatus = reply.planStatus.flatMap((p) => {
    const demo = DEMO_PLAN.items.find((i) => i.id === p.itemId)!;
    const real = r.plan?.items.find((i) => i.enabled && i.text === demo.text);
    return real ? [{ ...p, itemId: real.id, evidence: p.evidence.map((id) => idMap.get(id)!) }] : [];
  });
  return reply;
}
