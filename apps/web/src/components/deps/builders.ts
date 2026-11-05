/**
 * TEMPORARY stand-ins for pure builders owned by other lanes:
 * - Sujal: SUPPORT_PRESETS, newSupportCard, addCustomItem, buildSupportCardText, syncPersona,
 *          buildShareText, buildKitText, shouldPlayFinishSound  (@/features/support, @/features/share)
 * - Aakash: FOCUS_LABEL, itemsForFocus, summarizeSession, startLevelFor  (@/features/practice)
 * - Rudheer: isCrisis  (@/lib/crisis)
 * Signatures are our best guess from plan 04. Swap in `deps/index.ts` and fix any call site the
 * real signatures change.
 */
import type { Focus, HelpLevel, Persona, PlanItem, PracticeSession, RumiState, Settings, SupportCard, VisitPlan } from '@/features/shared/types';

const uid = (): string => Math.random().toString(36).slice(2, 10);

// ---------- crisis (Rudheer). Minimal phrase list so the UI path can be tested; the server check is the real one.
const CRISIS = [/\bkill (my ?self|myself)\b/i, /\bsuicid/i, /\bhurt (my ?self|myself)\b/i, /\bend my life\b/i, /\bwant to die\b/i];
export const isCrisis = (text: string): boolean => CRISIS.some((r) => r.test(text));

// ---------- support card (Sujal)
export const SUPPORT_PRESETS: readonly string[] = [
  'Please speak slowly.',
  'Please use plain words.',
  'Please write down what I should do.',
  'Please give me time to answer.',
  'Please tell me before you touch me.',
  'Please ask me, not the person with me.',
];

export function newSupportCard(plan: VisitPlan | undefined, persona: Persona): SupportCard {
  const remembered = new Set(persona.facts.filter((f) => f.kind === 'support_pref').map((f) => f.text));
  const wantsWritten = plan?.items.some((i) => i.enabled && i.kind === 'accommodation' && /write/i.test(i.text)) ?? false;
  return {
    id: `card-${uid()}`,
    items: SUPPORT_PRESETS.map((text, n) => ({ id: `s${n + 1}`, text, source: 'preset' as const, enabled: remembered.has(text) || (wantsWritten && n === 2) })),
    topQuestionIds: [],
  };
}

export function addCustomItem(card: SupportCard, text: string): { card: SupportCard; error?: string } {
  const t = text.trim();
  if (!t) return { card, error: 'Write a short sentence first.' };
  if (t.length > 120) return { card, error: 'Keep it under 120 letters.' };
  if (card.items.filter((i) => i.source === 'user').length >= 4) return { card, error: 'You can add 4 of your own.' };
  return { card: { ...card, items: [...card.items, { id: `u-${uid()}`, text: t, source: 'user', enabled: true }] } };
}

export function buildSupportCardText(card: SupportCard, plan?: VisitPlan): string {
  const lines = ['HOW I LIKE TO BE SUPPORTED', ...card.items.filter((i) => i.enabled).map((i) => `- ${i.text}`)];
  const qs = card.topQuestionIds.map((id) => plan?.items.find((i) => i.id === id)?.text).filter((t): t is string => Boolean(t));
  if (qs.length) lines.push('', 'MY TOP QUESTIONS', ...qs.map((q, n) => `${n + 1}. ${q}`));
  return lines.join('\n');
}

/** Turn the user's own choices into persona facts. Never free health text. */
export async function syncPersona(_state: RumiState, update: (fn: (d: RumiState) => void) => void): Promise<void> {
  update((d) => {
    const prefs = d.supportCard?.items.filter((i) => i.enabled && i.source === 'preset') ?? [];
    const now = new Date().toISOString();
    const keep = d.persona.facts.filter((f) => f.kind !== 'support_pref');
    d.persona.facts = [...keep, ...prefs.map((p) => ({ id: `f-${p.id}`, kind: 'support_pref' as const, key: p.id, text: p.text, createdAt: now }))];
  });
}

// ---------- practice (Aakash)
export const FOCUS_LABEL: Record<Focus, string> = {
  problem: 'Explain my problem',
  questions: 'Ask my questions',
  needs: 'Ask for what I need',
  next_steps: 'Understand what to do next',
  whole: 'The whole visit',
};

export function itemsForFocus(plan: VisitPlan, focus: Focus): PlanItem[] {
  const on = plan.items.filter((i) => i.enabled);
  if (focus === 'problem') return on.filter((i) => i.kind === 'concern');
  if (focus === 'questions' || focus === 'next_steps') return on.filter((i) => i.kind === 'question');
  if (focus === 'needs') return on.filter((i) => i.kind === 'accommodation');
  return on;
}

export interface SessionSummary { total: number; saidMyself: number; saidWithHelp: number; helpCount: number; items: { item: PlanItem; covered: boolean; level: HelpLevel }[] }

export function summarizeSession(session: PracticeSession, plan: VisitPlan): SessionSummary {
  const items = itemsForFocus(plan, session.focus).map((item) => ({
    item, covered: session.coveredItemIds.includes(item.id), level: (session.helpLevelUsed[item.id] ?? 0) as HelpLevel,
  }));
  const covered = items.filter((i) => i.covered);
  return {
    total: items.length,
    saidMyself: covered.filter((i) => i.level === 0).length,
    saidWithHelp: covered.filter((i) => i.level > 0).length,
    helpCount: session.helpCount,
    items,
  };
}

/** Highest help level used last time for this kind of item, so help starts where it helped before. */
export function startLevelFor(state: RumiState, kind: PlanItem['kind']): HelpLevel {
  const last = state.sessions.at(-1);
  if (!last || !state.plan) return 0;
  const ids = state.plan.items.filter((i) => i.kind === kind).map((i) => i.id);
  return ids.reduce<HelpLevel>((m, id) => Math.max(m, last.helpLevelUsed[id] ?? 0) as HelpLevel, 0);
}

// ---------- share and kit (Sujal)
export type ShareKey = 'plan' | 'support' | 'discussed' | 'instructions' | 'medications' | 'next_steps' | 'said';
const SECTION_TITLE = { discussed: 'WHAT WE TALKED ABOUT', instructions: 'WHAT THE CLINICIAN TOLD ME TO DO', medications: 'MEDICINES I HEARD', next_steps: 'MY NEXT STEPS' } as const;

export function buildShareText(selection: ReadonlySet<ShareKey>, state: RumiState): string {
  const out: string[] = [];
  const { plan, supportCard, recap } = state;
  if (selection.has('plan') && plan) out.push(['MY PLAN', `Main concern: ${plan.mainConcern}`, ...plan.items.filter((i) => i.enabled).map((i) => `- ${i.text}`)].join('\n'));
  if (selection.has('support') && supportCard) out.push(buildSupportCardText(supportCard, plan));
  for (const s of ['discussed', 'instructions', 'medications', 'next_steps'] as const) {
    const items = recap?.items.filter((i) => i.section === s) ?? [];
    if (selection.has(s) && items.length) out.push([SECTION_TITLE[s], ...items.map((i) => `- ${i.text}`)].join('\n'));
  }
  if (selection.has('said') && recap && plan) {
    const label = { asked_by_me: 'I asked', asked_by_other: 'Someone else asked', not_asked: 'Not asked', unclear: 'Not clear' } as const;
    out.push(['WHAT I SAID MYSELF', ...recap.planStatus.map((p) => {
      const t = plan.items.find((i) => i.id === p.itemId)?.text;
      return t ? `- ${t} (${label[p.status]})` : '';
    }).filter(Boolean)].join('\n'));
  }
  return out.join('\n\n');
}

export function buildKitText(state: RumiState): string {
  const all = new Set<ShareKey>(['plan', 'support']);
  return ['MY VISIT KIT', '', buildShareText(all, state)].join('\n');
}

export const shouldPlayFinishSound = (s: Settings): boolean => s.finishSound && !s.reducedMotion;
