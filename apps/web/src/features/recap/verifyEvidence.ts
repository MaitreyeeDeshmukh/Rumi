import type { RecapItem, PlanStatusEntry, TranscriptLine, Speaker } from '../shared/types';
export interface RawRecap { items: RecapItem[]; unconfirmed: string[]; planStatus: PlanStatusEntry[] }
const normalize = (s: string) => s.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
const instructionAttack = /ignore.{0,30}(rules|instructions)|system\s*:|system prompt|reveal.{0,20}(key|prompt)|mark every plan/i;
/** Conservative extractive verifier. Speaker A is the clinician in our synthetic sample ONLY.
 * This does not authenticate speakers in real recordings or prove medical accuracy.
 */
export function verifyEvidence(lines: TranscriptLine[], raw: RawRecap, mySpeaker: Speaker, clinicianSpeaker: Speaker = 'A'): RawRecap & { dropped: number } {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const duplicateIds = byId.size !== lines.length;
  const items: RecapItem[] = []; const unconfirmed = [...raw.unconfirmed]; let dropped = 0;
  for (const item of raw.items) {
    const evidence = [...new Set(item.evidence)];
    const cited = evidence.map((id) => byId.get(id));
    const medical = item.section !== 'discussed';
    const sourceLines = cited.filter((l): l is TranscriptLine => Boolean(l));
    const sourceSentences = sourceLines.flatMap((l) => l.text.split(/(?<=[.!?])\s+/).map(normalize));
    const quotedSentences = item.text.split(/(?<=[.!?])\s+/).map(normalize);
    const text = normalize(item.text);
    const valid = !duplicateIds && evidence.length > 0 && cited.every(Boolean) && Boolean(text) &&
      !sourceLines.some((l) => instructionAttack.test(l.text)) &&
      (!medical || sourceLines.every((l) => l.speaker === clinicianSpeaker)) &&
      quotedSentences.every((sentence) => sourceSentences.includes(sentence));
    if (valid) items.push({ ...item, evidence });
    else { dropped++; unconfirmed.push(`I could not confirm summary item ${raw.items.indexOf(item) + 1}. Please check the transcript.`); }
  }
  const seen = new Set<string>();
  const planStatus = raw.planStatus.filter((p) => { if (seen.has(p.itemId)) return false; seen.add(p.itemId); return true; }).map((p): PlanStatusEntry => {
    if (p.status === 'not_asked') return { ...p, evidence: [] };
    const evidence = [...new Set(p.evidence)]; const cited = evidence.map((id) => byId.get(id));
    const valid = !duplicateIds && evidence.length > 0 && cited.every((l) => l && !instructionAttack.test(l.text) &&
      (p.status === 'asked_by_me' ? l.speaker === mySpeaker : p.status === 'asked_by_other' ? l.speaker !== mySpeaker : false));
    return valid ? { ...p, evidence } : { itemId: p.itemId, status: 'unclear', evidence: [] };
  });
  return { items, unconfirmed: [...new Set(unconfirmed)].slice(0, 10), planStatus, dropped };
}
