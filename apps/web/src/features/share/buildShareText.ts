/**
 * Builds the plain text a person copies, prints or shares. Pure. The person picks every part; nothing is added
 * on their behalf except one fixed footer line when a recap section is included.
 */
import { supportSection, CONCERN_HEADING } from '@/features/support/card';
import { bringBlock } from '@/features/checklist/bringBlock';
import type { PlanStatus, RecapSection, RumiState } from '@/features/shared/types';

export interface ShareSelection {
  plan: boolean;
  supportCard: boolean;
  recapSections: Partial<Record<RecapSection, boolean>>;
  saidMyself: boolean;
  /** What to bring to the next visit. */
  bring?: boolean;
}
export const EMPTY_SELECTION: ShareSelection = { plan: false, supportCard: false, recapSections: {}, saidMyself: false };

export const RECAP_TITLES: Record<RecapSection, string> = {
  discussed: 'What we talked about',
  instructions: 'What the clinician told me to do',
  medications: 'Medicines I heard',
  next_steps: 'My next steps',
};
export const RECAP_FOOTER = 'Check anything important with your clinician.';

const RECAP_ORDER: readonly RecapSection[] = ['discussed', 'instructions', 'medications', 'next_steps'];
const STATUS_GROUPS: readonly [PlanStatus, string][] = [
  ['asked_by_me', 'Asked by me:'],
  ['asked_by_other', 'Asked by someone else:'],
  ['not_asked', 'Not asked:'],
  ['unclear', 'Not clear:'],
];

const bullets = (lines: string[]): string => lines.map((t) => `- ${t}`).join('\n');

function planBlock(state: RumiState): string {
  const plan = state.plan;
  if (!plan) return '';
  const concern = plan.mainConcern.trim();
  const items = plan.items.filter((i) => i.enabled).map((i) => i.text);
  return [concern ? `${CONCERN_HEADING}\n${concern}` : '', items.length ? `What I want to say and ask\n${bullets(items)}` : '']
    .filter(Boolean)
    .join('\n\n');
}

function recapBlock(state: RumiState, section: RecapSection): string {
  const lines = (state.recap?.items ?? []).filter((i) => i.section === section).map((i) => i.text);
  return `${RECAP_TITLES[section]}\n${lines.length ? bullets(lines) : 'Nothing was noted.'}`;
}

function saidMyselfBlock(state: RumiState): string {
  const texts = new Map((state.plan?.items ?? []).filter((i) => i.enabled).map((i) => [i.id, i.text]));
  const groups = STATUS_GROUPS.map(([status, heading]) => {
    const lines = (state.recap?.planStatus ?? [])
      .filter((p) => p.status === status)
      .map((p) => texts.get(p.itemId))
      .filter((t): t is string => !!t);
    return lines.length ? `${heading}\n${bullets(lines)}` : '';
  }).filter(Boolean);
  return groups.length ? ['What I said myself', ...groups].join('\n') : '';
}

/** '' when nothing is selected, or when what was selected does not exist. */
export function buildShareText(sel: ShareSelection, state: RumiState): string {
  // A recap section can only be shared when there is a recap: no recap means no section and no footer.
  const chosen = state.recap ? RECAP_ORDER.filter((s) => sel.recapSections[s] === true) : [];
  const blocks = [
    sel.plan ? planBlock(state) : '',
    sel.supportCard && state.supportCard ? supportSection(state.supportCard) : '',
    ...chosen.map((s) => recapBlock(state, s)),
    sel.saidMyself ? saidMyselfBlock(state) : '',
    sel.bring ? bringBlock(state, new Date()) : '',
    chosen.length ? RECAP_FOOTER : '',
  ];
  return blocks.filter(Boolean).join('\n\n');
}
