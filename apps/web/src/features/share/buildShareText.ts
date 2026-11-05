import type { PlanStatus, RecapSection, RumiState, Settings, VisitPlan } from '@/features/shared/types';
import { buildSupportCardText, newSupportCard } from '@/features/support/card';

export interface ShareSelection { plan: boolean; supportCard: boolean; recapSections: Partial<Record<RecapSection, boolean>>; saidMyself: boolean }
export const EMPTY_SELECTION: ShareSelection = { plan: false, supportCard: false, recapSections: {}, saidMyself: false };

export const RECAP_TITLES: Record<RecapSection, string> = {
  discussed: 'What we talked about',
  instructions: 'What the clinician told me to do',
  medications: 'Medicines I heard',
  next_steps: 'My next steps',
};
const RECAP_ORDER: RecapSection[] = ['discussed', 'instructions', 'medications', 'next_steps'];
const STATUS_TITLES: [PlanStatus, string][] = [
  ['asked_by_me', 'Asked by me:'],
  ['asked_by_other', 'Asked by someone else:'],
  ['not_asked', 'Not asked:'],
  ['unclear', 'Not clear:'],
];
export const SAMPLE_LABEL = 'Sample visit, made by our team';
export const RECAP_FOOTER = 'Check anything important with your clinician.';

const list = (title: string, lines: string[]): string => [title, ...lines.map((l) => `- ${l}`)].join('\n');

function planText(plan: VisitPlan): string {
  const blocks: string[] = [];
  if (plan.mainConcern.trim()) blocks.push(`My main concern\n${plan.mainConcern.trim()}`);
  if (plan.symptomsInMyWords.length) blocks.push(list('In my words', plan.symptomsInMyWords));
  const items = plan.items.filter((i) => i.enabled);
  if (items.length) blocks.push(list('What I want to say and ask', items.map((i) => i.text)));
  return blocks.join('\n\n');
}

function saidMyselfText(state: RumiState): string {
  const { plan, recap } = state;
  if (!plan || !recap) return '';
  const textOf = new Map(plan.items.filter((i) => i.enabled).map((i) => [i.id, i.text]));
  const groups = STATUS_TITLES.map(([status, title]) => {
    const texts = recap.planStatus.filter((e) => e.status === status && textOf.has(e.itemId)).map((e) => textOf.get(e.itemId)!);
    return texts.length ? list(title, texts) : '';
  }).filter(Boolean);
  return groups.length ? ['What I said myself', ...groups].join('\n') : '';
}

/** Plain text the user chose to share. '' when nothing is selected or nothing is left. */
export function buildShareText(sel: ShareSelection, state: RumiState): string {
  const blocks: string[] = [];
  if (sel.plan && state.plan) blocks.push(planText(state.plan));
  // When the plan block is already in, the card leaves out the concern and questions so nothing repeats.
  if (sel.supportCard && state.supportCard) blocks.push(buildSupportCardText(state.supportCard, sel.plan ? undefined : state.plan));

  const recap = state.recap;
  const recapBlocks = recap
    ? RECAP_ORDER.filter((s) => sel.recapSections[s])
      .map((s) => ({ s, texts: recap.items.filter((i) => i.section === s).map((i) => i.text) }))
      .filter((b) => b.texts.length)
      .map((b) => list(RECAP_TITLES[b.s], b.texts))
    : [];
  if (recapBlocks.length) blocks.push(SAMPLE_LABEL, ...recapBlocks);
  if (sel.saidMyself) blocks.push(saidMyselfText(state));

  const out = blocks.filter(Boolean);
  if (!out.length) return '';
  if (recapBlocks.length) out.push(RECAP_FOOTER);
  return out.join('\n\n');
}

/** Visit kit: support card + plan concern + top 2 questions. Uses last time's choices if no card was made yet. */
export function buildKitText(state: RumiState): string {
  return buildSupportCardText(state.supportCard ?? newSupportCard(state.plan, state.persona), state.plan);
}

export const shouldPlayFinishSound = (s: Settings): boolean => s.finishSound === true;
