import type { FactKind, Focus, HelpLevel, PersonaFact, PlanItem, RumiState } from '@/features/shared/types';

export const MAX_FACTS = 40;
export const MAX_FACT_CHARS = 140;
export const MAX_FACT_WORDS = 15;
export const FACT_KINDS: readonly FactKind[] = ['support_pref', 'pacing', 'help_level', 'focus_pref'];

/** Same shape as Aakash's HelpHistoryEntry (src/features/practice/nextStartLevel.ts). */
export interface HelpHistoryEntry { level: HelpLevel; stuck: boolean }

/** Teammates' functions this module stands on. Wired to the real modules once they land. */
export interface PersonaDeps {
  normalizeUserText: (raw: string, max: number) => string;       // Rudheer, lib/ai/guards/input
  scanInjection: (t: string) => unknown;                          // Rudheer: truthy = injection found
  redactPii: (t: string) => { count: number };                    // Rudheer
  isCrisis: (t: string) => boolean;                               // Rudheer, lib/crisis
  literalLint: (t: string) => { ok: boolean };                    // Aakash, lib/literalLint
  focusLabel: Record<Focus, string>;                              // Aakash, features/practice/labels
}

export const factId = (kind: FactKind, key: string): string => `${kind}:${key}`; // stable id => upserts are idempotent

// Fixed words only: a fact never contains plan text. Each template stays within 15 words
// (the longest, accommodation + level 2, is exactly 15).
const KIND_WORD: Record<PlanItem['kind'], string> = { concern: 'explaining my problem', question: 'asking my questions', accommodation: 'asking for my needs' };
const LEVEL_WORD: Record<HelpLevel, string> = { 0: 'no help', 1: 'a hint', 2: 'a sentence with blanks', 3: 'a full sentence' };
const PACING: Record<string, string> = { p2: 'one_question', p5: 'extra_time' };

const words = (t: string): number => t.split(/\s+/).filter(Boolean).length;
const digits = (t: string): number => (t.match(/\d/g) ?? []).length;

/**
 * Per plan-item kind, oldest first: the highest help level used in each session of the CURRENT plan
 * (same planId rule as Aakash's startLevelFor). Feeds the help_level facts only; the start level itself
 * comes from features/practice/startLevelFor so the app has one answer.
 */
export function helpHistoryFor(state: RumiState, kind: PlanItem['kind']): HelpHistoryEntry[] {
  const plan = state.plan;
  if (!plan) return [];
  const ids = new Set(plan.items.filter((i) => i.kind === kind).map((i) => i.id));
  return state.sessions.filter((s) => s.planId === plan.id).flatMap((s) => {
    const levels = Object.entries(s.helpLevelUsed ?? {}).filter(([id]) => ids.has(id)).map(([, l]) => l);
    if (!levels.length) return [];
    const level = Math.max(...levels) as HelpLevel;
    return [{ level, stuck: level === 3 }];
  });
}

export function createPersona(deps: PersonaDeps) {
  /** Strict allowlist. Used on write (browser + server) AND on read (server) so a poisoned fact can never reach a prompt. */
  function sanitizeText(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const t = deps.normalizeUserText(raw, MAX_FACT_CHARS + 1);
    if (!t || t.length > MAX_FACT_CHARS || words(t) > MAX_FACT_WORDS) return null;
    if (/https?:|www\.|@/i.test(t) || digits(t) >= 3) return null; // links, emails, phone or id numbers
    if (deps.isCrisis(t) || deps.scanInjection(t) || deps.redactPii(t).count > 0) return null;
    if (!deps.literalLint(t).ok) return null;
    return t;
  }

  function sanitizeFact(f: PersonaFact): PersonaFact | null {
    if (!f || typeof f !== 'object') return null;
    if (!FACT_KINDS.includes(f.kind)) return null;
    if (typeof f.key !== 'string' || !/^[a-z0-9:_-]{1,40}$/i.test(f.key)) return null;
    if (f.kind === 'help_level' && ![0, 1, 2, 3].includes(f.level as number)) return null;
    const text = sanitizeText(f.text);
    if (!text) return null;
    const out: PersonaFact = { id: factId(f.kind, f.key), kind: f.kind, key: f.key, text, createdAt: typeof f.createdAt === 'string' ? f.createdAt.slice(0, 40) : '' };
    if (f.kind === 'help_level') out.level = f.level;
    return out; // rebuilt field by field: unknown extra fields never pass through
  }

  /** Facts come only from what the user chose (support card) or did (practice). Nothing is inferred. */
  function factsFromState(state: RumiState, now = new Date().toISOString()): PersonaFact[] {
    const out: PersonaFact[] = [];
    for (const it of state.supportCard?.items ?? []) {
      if (!it.enabled) continue;
      const key = it.source === 'preset' ? it.id : `u-${it.id}`;
      out.push({ id: factId('support_pref', key), kind: 'support_pref', key, text: it.text, createdAt: now });
      const pace = it.source === 'preset' ? PACING[it.id] : undefined;
      if (pace) out.push({ id: factId('pacing', pace), kind: 'pacing', key: pace, text: it.text, createdAt: now });
    }
    for (const kind of ['concern', 'question', 'accommodation'] as const) {
      const last = helpHistoryFor(state, kind).at(-1);
      if (last) {
        out.push({
          id: factId('help_level', kind), kind: 'help_level', key: kind, level: last.level, createdAt: now,
          text: `When I practice ${KIND_WORD[kind]}, I needed ${LEVEL_WORD[last.level]} last time.`,
        });
      }
    }
    const lastFocus = state.sessions.at(-1)?.focus;
    if (lastFocus && deps.focusLabel[lastFocus]) {
      out.push({ id: factId('focus_pref', 'last_focus'), kind: 'focus_pref', key: 'last_focus', text: `I last practiced: ${deps.focusLabel[lastFocus]}.`, createdAt: now });
    }
    return out.map(sanitizeFact).filter((f): f is PersonaFact => !!f).slice(0, MAX_FACTS);
  }

  return { sanitizeText, sanitizeFact, factsFromState };
}
