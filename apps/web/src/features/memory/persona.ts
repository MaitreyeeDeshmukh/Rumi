/**
 * Persona facts: what Rumi may remember about a person. A fact is a choice the person made, written as
 * (kind, key, level) with no free text. The facts are built from ids and fixed tables only, so nothing the
 * person typed (plan, symptoms, custom support lines, name) can end up in a fact.
 */
import { LIMITS, PLAN_ITEM_KINDS, STATED_FACT_KINDS } from '@/features/shared/constants';
import type { PersonaFactRemovalT, PersonaFactSyncT } from '@/features/shared/schemas';
import type { FactKind, HelpLevel, Persona, PersonaFact, PersonaRemoval, PlanItemKind, RumiState } from '@/features/shared/types';
import { presetText } from '@/features/support/presets';
import { PACING_PRESET, factText } from './factText';

/** Stable id, so writing the same fact twice is an update, never a second copy. */
const factId = (kind: FactKind, key: string): string => `${kind}:${key}`;

/** One entry per practice that used this kind of plan item. Shape is what the start-level rule reads. */
export interface HelpHistoryEntry {
  level: HelpLevel;
  /** True when the full sentence (level 3) was needed. */
  stuck: boolean;
  /** When that practice started (ISO). */
  at: string;
}

/** Highest help level used per plan-item kind, session by session, oldest first. */
export function helpHistoryFor(state: RumiState, kind: PlanItemKind): HelpHistoryEntry[] {
  const out: HelpHistoryEntry[] = [];
  for (const s of state.sessions) {
    if (!Object.hasOwn(s.helpLevelUsed, kind)) continue;
    const level = s.helpLevelUsed[kind];
    if (level !== undefined) out.push({ level, stuck: level === 3, at: s.startedAt });
  }
  return out;
}

/** One ISO form (with Z), or undefined when the text is not a time. */
const isoOrUndefined = (t: string | undefined): string | undefined => {
  const ms = t === undefined ? Number.NaN : Date.parse(t);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
};

/**
 * Facts for the current state. Only enabled preset support lines (by id) and help levels per kind.
 * `updatedAt` is the time the person last changed the fact, kept stable across calls so two devices can compare:
 * a stated fact keeps its time until it is turned off and on again; a help level carries the time of the practice it came from.
 */
export function factsFromState(state: RumiState, now: string = new Date().toISOString()): PersonaFact[] {
  const before = new Map(state.persona.facts.map((f) => [f.id, f]));
  const out: PersonaFact[] = [];
  const add = (kind: FactKind, key: string, level?: HelpLevel, changedAt?: string): void => {
    if (factText(kind, key, level) === null) return;
    const id = factId(kind, key);
    if (out.some((f) => f.id === id)) return;
    const old = before.get(id);
    const updatedAt = isoOrUndefined(changedAt) ?? (old && old.level === level ? isoOrUndefined(old.updatedAt) : undefined) ?? now;
    out.push({ id, kind, key, ...(level === undefined ? {} : { level }), createdAt: old?.createdAt ?? now, updatedAt });
  };

  for (const it of state.supportCard?.items ?? []) {
    if (!it.enabled || it.source !== 'preset' || presetText(it.id) === undefined) continue;
    add('support_pref', it.id);
    for (const [pace, presetId] of PACING_PRESET) if (presetId === it.id) add('pacing', pace);
  }
  for (const kind of PLAN_ITEM_KINDS) {
    const last = helpHistoryFor(state, kind).at(-1);
    if (last) add('help_level', kind, last.level, last.at);
  }
  return out;
}

const isStated = (kind: string): boolean => (STATED_FACT_KINDS as readonly string[]).includes(kind);

/**
 * Stated facts the person turned off since the last call: they were in `before`, are not in `after`, and there is a
 * support card to say so. Without a card the list is empty, so a device that has not made one yet (a new device)
 * can never delete what another device saved. A fact that is back is no longer pending. Oldest entries stay if the list is full.
 */
export function pendingRemovals(before: Persona, after: readonly PersonaFact[], hasCard: boolean, now: string): PersonaRemoval[] {
  const alive = new Set(after.map((f) => f.id));
  const kept = (before.removed ?? []).filter((r) => !alive.has(r.id));
  if (!hasCard) return kept;
  const known = new Set(kept.map((r) => r.id));
  const fresh = before.facts.filter((f) => isStated(f.kind) && !alive.has(f.id) && !known.has(f.id)).map((f) => ({ id: f.id, at: now }));
  return [...kept, ...fresh].slice(0, LIMITS.factsMax);
}

/** What goes over the network: kind, key, level and the change time only. */
export const toSyncFacts = (facts: readonly PersonaFact[]): PersonaFactSyncT[] =>
  facts.map((f) => ({ kind: f.kind, key: f.key, ...(f.level === undefined ? {} : { level: f.level }), client_updated_at: f.updatedAt }));

export const toWireRemovals = (removed: readonly PersonaRemoval[]): PersonaFactRemovalT[] =>
  removed.flatMap((r) => {
    const [kind, key] = r.id.split(':');
    return kind === 'support_pref' || kind === 'pacing' ? [{ kind, key, client_updated_at: r.at }] : [];
  });

/**
 * Folds the stored set (what the database holds after a write) into the local facts. Newer wins, per fact.
 * A stored fact this device does not have is taken only while there is no support card: a device that already has a
 * card is the author of its own stated facts, and a fact it turned off must not come back.
 */
export function mergeRemote(state: RumiState, remote: readonly PersonaFactSyncT[]): PersonaFact[] {
  const merged = new Map(state.persona.facts.map((f) => [f.id, f]));
  const pendingOff = new Set((state.persona.removed ?? []).map((r) => r.id));
  for (const r of remote) {
    const id = factId(r.kind, r.key);
    const mine = merged.get(id);
    if (mine) {
      if (Date.parse(r.client_updated_at) > (Date.parse(mine.updatedAt) || 0)) {
        merged.set(id, { id, kind: mine.kind, key: mine.key, ...(r.level === undefined ? {} : { level: r.level }), createdAt: mine.createdAt, updatedAt: r.client_updated_at });
      }
    } else if (!state.supportCard && !pendingOff.has(id)) {
      merged.set(id, { id, kind: r.kind, key: r.key, ...(r.level === undefined ? {} : { level: r.level }), createdAt: r.client_updated_at, updatedAt: r.client_updated_at });
    }
  }
  return [...merged.values()].slice(0, LIMITS.factsMax);
}
