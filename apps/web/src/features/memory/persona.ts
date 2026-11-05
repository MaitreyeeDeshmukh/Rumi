/**
 * Persona facts: what Rumi may remember about a person. A fact is a choice the person made, written as
 * (kind, key, level) with no free text. The facts are built from ids and fixed tables only, so nothing the
 * person typed (plan, symptoms, custom support lines, name) can end up in a fact.
 */
import { nextStartLevel, type HelpHistoryEntry } from '@/features/practice/nextStartLevel';
import { PLAN_ITEM_KINDS } from '@/features/shared/constants';
import type { PersonaFactWireT } from '@/features/shared/schemas';
import type { FactKind, HelpLevel, PersonaFact, PlanItemKind, RumiState } from '@/features/shared/types';
import { presetText } from '@/features/support/presets';
import { PACING_PRESET, factText } from './factText';

/** Stable id, so writing the same fact twice is an update, never a second copy. */
const factId = (kind: FactKind, key: string): string => `${kind}:${key}`;

/** Highest help level used per plan-item kind, session by session, oldest first. */
export function helpHistoryFor(state: RumiState, kind: PlanItemKind): HelpHistoryEntry[] {
  const out: HelpHistoryEntry[] = [];
  for (const s of state.sessions) {
    if (!Object.hasOwn(s.helpLevelUsed, kind)) continue;
    const level = s.helpLevelUsed[kind];
    if (level !== undefined) out.push({ level, stuck: level === 3 });
  }
  return out;
}

/** Where the Help button starts for this kind of plan item: one step below the last help used, 0 meaning "say it alone". Callers use max(1, result) for the first help answer. */
export const startLevelFor = (state: RumiState, kind: PlanItemKind): HelpLevel => nextStartLevel(helpHistoryFor(state, kind));

/** Facts for the current state. Only enabled preset support lines (by id) and help levels per kind. */
export function factsFromState(state: RumiState, now: string = new Date().toISOString()): PersonaFact[] {
  const before = new Map(state.persona.facts.map((f) => [f.id, f.createdAt]));
  const out: PersonaFact[] = [];
  const add = (kind: FactKind, key: string, level?: HelpLevel): void => {
    if (factText(kind, key, level) === null) return;
    const id = factId(kind, key);
    if (out.some((f) => f.id === id)) return;
    out.push({ id, kind, key, ...(level === undefined ? {} : { level }), createdAt: before.get(id) ?? now });
  };

  for (const it of state.supportCard?.items ?? []) {
    if (!it.enabled || it.source !== 'preset' || presetText(it.id) === undefined) continue;
    add('support_pref', it.id);
    for (const [pace, presetId] of PACING_PRESET) if (presetId === it.id) add('pacing', pace);
  }
  for (const kind of PLAN_ITEM_KINDS) {
    const last = helpHistoryFor(state, kind).at(-1);
    if (last) add('help_level', kind, last.level);
  }
  return out;
}

/** What goes over the network: kind, key and level only. */
export const toWireFacts = (facts: readonly PersonaFact[]): PersonaFactWireT[] =>
  facts.map((f) => ({ kind: f.kind, key: f.key, ...(f.level === undefined ? {} : { level: f.level }) }));
