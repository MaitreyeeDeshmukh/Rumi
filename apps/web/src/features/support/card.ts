import type { Persona, SupportCard, SupportItem, VisitPlan } from '@/features/shared/types';
import { MAX_CUSTOM_WORDS, SUPPORT_PRESETS } from './presets';

export const CARD_ID = 'support-card';
export const ERR_EMPTY = 'Write one sentence first.';
export const ERR_UNCLEAR = 'Make it shorter and clearer: 15 words or fewer, one idea.';

/** Aakash's literalLint (src/lib/literalLint.ts); only `ok` is used here. */
export type LintFn = (text: string) => { ok: boolean };

const wordCount = (t: string): number => t.split(/\s+/).filter(Boolean).length;

/** Ids of the first two enabled question items of the plan. */
export const topQuestionIdsFor = (plan: VisitPlan | undefined): string[] =>
  (plan?.items ?? []).filter((i) => i.enabled && i.kind === 'question').slice(0, 2).map((i) => i.id);

/** One item per preset, enabled only if the user chose it before (persona fact support_pref:<id>). */
export function newSupportCard(plan: VisitPlan | undefined, persona: Persona): SupportCard {
  const chosen = new Set(persona.facts.filter((f) => f.kind === 'support_pref').map((f) => f.key));
  const items: SupportItem[] = SUPPORT_PRESETS.map((p) => ({ id: p.id, text: p.text, source: 'preset', enabled: chosen.has(p.id) }));
  return { id: CARD_ID, items, topQuestionIds: topQuestionIdsFor(plan) };
}

/** Builds addCustomItem around the lint, so it can be tested before literalLint lands. */
export function createAddCustomItem(lint: LintFn) {
  return function addCustomItem(card: SupportCard, text: string): { card: SupportCard; error?: string } {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return { card, error: ERR_EMPTY };
    if (wordCount(t) > MAX_CUSTOM_WORDS || !lint(t).ok) return { card, error: ERR_UNCLEAR };
    // Next free number, so ids stay unique even after an item was removed.
    const n = Math.max(0, ...card.items.filter((i) => i.source === 'user').map((i) => Number(i.id.slice(1)) || 0)) + 1;
    return { card: { ...card, items: [...card.items, { id: `u${n}`, text: t, source: 'user', enabled: true }] } };
  };
}

/** Plain text (no markdown) so Copy and Print match the screen. '' when nothing is left. */
export function buildSupportCardText(card: SupportCard, plan: VisitPlan | undefined): string {
  const blocks: string[] = [];
  const support = card.items.filter((i) => i.enabled);
  if (support.length) blocks.push(['How I like to be supported', ...support.map((i) => `- ${i.text}`)].join('\n'));
  const concern = plan?.mainConcern.trim();
  if (concern) blocks.push(`My main concern\n${concern}`);
  const questions = card.topQuestionIds.slice(0, 2)
    .map((id) => plan?.items.find((i) => i.id === id && i.enabled))
    .filter((i) => !!i);
  if (questions.length) blocks.push(['My top questions', ...questions.map((q, n) => `${n + 1}. ${q.text}`)].join('\n'));
  return blocks.join('\n\n');
}
