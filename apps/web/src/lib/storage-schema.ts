/**
 * Reads whatever is in localStorage and turns it into a valid RumiState, one field at a time.
 * A bad field falls back to its default; a bad list entry is dropped; nothing else is lost.
 * The stored text is untrusted (another tab, an old version, a person editing it by hand).
 */
import { z } from 'zod';
import { ID_RE, LIMITS, PLAN_ITEM_KINDS } from '@/features/shared/constants';
import {
  FocusSchema,
  HelpLevelSchema,
  PersonaFactRemoval,
  PersonaFactWire,
  PlanItemSchema,
  RecapReply,
  SpeakerSchema,
  TranscriptLineSchema,
  TurnSchema,
  VisitPlanSchema,
} from '@/features/shared/schemas';
import type {
  PersonaFact,
  PersonaRemoval,
  PracticeSession,
  Recap,
  RumiState,
  Settings,
  SupportCard,
  SupportItem,
  VisitPlan,
} from '@/features/shared/types';
import { presetText } from '@/features/support/presets';

export const MAX_SESSIONS = 20;
const MAX_SUPPORT_ITEMS = 20;
const MAX_STORED_TURNS = 40;

export const defaultSettings = (): Settings => ({
  name: '',
  companionName: 'Rumi',
  theme: 'soft',
  textScale: 1,
  reducedMotion: false,
  outputMode: 'both',
  detail: 'short',
  speechRate: 1,
  finishSound: false,
  memoryOptIn: false,
  onboarded: false,
});

export const defaultState = (): RumiState => ({ version: 1, settings: defaultSettings(), sessions: [], persona: { facts: [] } });

const Id = z.string().regex(ID_RE);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Own data property only: stored JSON may carry "__proto__" or "constructor" keys. */
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

/** Parses each entry on its own and keeps the valid ones. Not an array gives an empty list. */
function validItems<T>(schema: z.ZodType<T>, raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const entry of raw) {
    const r = schema.safeParse(entry);
    if (r.success) out.push(r.data);
  }
  return out;
}

function uniqueBy<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const text = (max: number) => z.string().catch('').transform((s) => s.slice(0, max));

const SettingsSchema = z
  .object({
    name: text(80),
    companionName: z.string().regex(/^[A-Za-z][A-Za-z '-]{0,29}$/).catch('Rumi'),
    theme: z.enum(['soft', 'contrast', 'low']).catch('soft'),
    textScale: z.union([z.literal(1), z.literal(1.15), z.literal(1.3), z.literal(1.5)]).catch(1),
    reducedMotion: z.boolean().catch(false),
    outputMode: z.enum(['read', 'listen', 'both']).catch('both'),
    detail: z.enum(['short', 'detailed']).catch('short'),
    speechRate: z.number().min(0.5).max(2).catch(1),
    finishSound: z.boolean().catch(false),
    memoryOptIn: z.boolean().catch(false),
    onboarded: z.boolean().catch(false),
  })
  .catch(defaultSettings);

const HelpLevelsRaw = z.unknown().transform((raw): PracticeSession['helpLevelUsed'] => {
  const out: PracticeSession['helpLevelUsed'] = {};
  if (!isObject(raw)) return out;
  for (const kind of PLAN_ITEM_KINDS) {
    const level = HelpLevelSchema.safeParse(own(raw, kind));
    if (level.success) out[kind] = level.data;
  }
  return out;
}).catch(() => ({}));

const TurnList = z.unknown().transform((raw) => validItems(TurnSchema, raw).slice(0, MAX_STORED_TURNS)).catch(() => []);
const IdList = z.unknown().transform((raw) => validItems(Id, raw).slice(0, LIMITS.planItemsMax)).catch(() => []);
const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional().catch(undefined);

const SessionSchema = z.object({
  id: Id,
  planId: Id,
  startedAt: text(40),
  focus: FocusSchema.catch('whole'),
  readyBefore: Rating,
  readyAfter: Rating,
  turns: TurnList,
  coveredItemIds: IdList,
  helpCount: z.number().int().min(0).max(1000).catch(0),
  helpLevelUsed: HelpLevelsRaw,
});

function parsePlan(raw: unknown): VisitPlan | undefined {
  if (!isObject(raw) || !Array.isArray(raw.items)) return undefined;
  const head = z
    .object({
      id: Id,
      title: text(80),
      createdAt: text(40),
      mainConcern: text(LIMITS.concernMax),
      symptomsInMyWords: z.unknown().transform((v) => validItems(z.string().max(100), v).slice(0, 12)).catch(() => []),
    })
    .safeParse(raw);
  if (!head.success) return undefined;
  const items = uniqueBy(validItems(PlanItemSchema, raw.items), (i) => i.id).slice(0, LIMITS.planItemsMax);
  const plan = { ...head.data, items };
  return VisitPlanSchema.safeParse(plan).success ? plan : undefined;
}

const SupportItemRaw = z.object({ id: Id, text: z.string().max(LIMITS.itemTextMax), source: z.enum(['preset', 'user']), enabled: z.boolean() });

function parseSupportCard(raw: unknown): SupportCard | undefined {
  if (!isObject(raw)) return undefined;
  const items: SupportItem[] = [];
  for (const it of validItems(SupportItemRaw, raw.items)) {
    if (it.source === 'preset') {
      // Preset text is never trusted from storage: the one table in presets.ts decides it.
      const canonical = presetText(it.id);
      if (canonical) items.push({ ...it, text: canonical });
    } else {
      items.push(it);
    }
  }
  return {
    id: Id.catch('support-card').parse(raw.id),
    items: uniqueBy(items, (i) => i.id).slice(0, MAX_SUPPORT_ITEMS),
    topQuestionIds: validItems(Id, raw.topQuestionIds).slice(0, 2),
  };
}

const RecapItem = RecapReply.shape.items.element;
const RecapStatus = RecapReply.shape.planStatus.element;

function parseRecap(raw: unknown): Recap | undefined {
  if (!isObject(raw)) return undefined;
  const head = z
    .object({
      id: Id,
      planId: Id.optional().catch(undefined),
      createdAt: text(40),
      isSample: z.literal(true).catch(true),
      isSavedFallback: z.boolean().catch(false),
      mySpeaker: SpeakerSchema,
    })
    .safeParse(raw);
  if (!head.success) return undefined;
  return {
    ...head.data,
    transcript: uniqueBy(validItems(TranscriptLineSchema, raw.transcript), (l) => l.id).slice(0, LIMITS.linesMax),
    items: validItems(RecapItem, raw.items).slice(0, 20),
    unconfirmed: validItems(z.string().max(400), raw.unconfirmed).slice(0, 30),
    planStatus: validItems(RecapStatus, raw.planStatus).slice(0, LIMITS.planItemsMax),
  };
}

const iso = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 40) : '');
/** A change time in the one form the server accepts (with Z), or '' when it is not a time. */
const isoTime = (v: unknown): string => {
  const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
};

/** Facts are rebuilt from (kind, key, level) only. Any stored id or free text is thrown away. */
function parseFacts(raw: unknown): PersonaFact[] {
  if (!Array.isArray(raw)) return [];
  const facts: PersonaFact[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const level = own(entry, 'level');
    const wire = PersonaFactWire.safeParse({ kind: own(entry, 'kind'), key: own(entry, 'key'), ...(level === undefined ? {} : { level }) });
    if (!wire.success) continue;
    const { kind, key } = wire.data;
    const createdAt = iso(own(entry, 'createdAt'));
    facts.push({
      id: `${kind}:${key}`,
      kind,
      key,
      ...(wire.data.level === undefined ? {} : { level: wire.data.level }),
      createdAt,
      // Data saved before updatedAt existed falls back to its creation time.
      updatedAt: isoTime(own(entry, 'updatedAt')) || createdAt,
    });
  }
  return uniqueBy(facts, (f) => f.id).slice(0, LIMITS.factsMax);
}

/** Pending removals: only stated facts with a real id and a time. Rebuilt from kind and key, never trusted as stored. */
function parseRemoved(raw: unknown): PersonaRemoval[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonaRemoval[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const id = own(entry, 'id');
    const at = isoTime(own(entry, 'at'));
    if (typeof id !== 'string' || at === '') continue;
    const [kind, key, extra] = id.split(':');
    if (extra !== undefined || !PersonaFactRemoval.safeParse({ kind, key, client_updated_at: '2026-01-01T00:00:00.000Z' }).success) continue;
    out.push({ id: `${kind}:${key}`, at });
  }
  return uniqueBy(out, (r) => r.id).slice(0, LIMITS.factsMax);
}

/** Turns untrusted parsed JSON into a valid state. Never throws. */
export function parseState(raw: unknown): RumiState {
  if (!isObject(raw) || raw.version !== 1) return defaultState();
  const settings = SettingsSchema.parse(raw.settings);
  const persona = isObject(raw.persona) ? raw.persona : {};
  const removed = parseRemoved(own(persona, 'removed'));
  const supportCard = parseSupportCard(raw.supportCard);
  const plan = parsePlan(raw.plan);
  const recap = parseRecap(raw.recap);
  return {
    version: 1,
    settings,
    sessions: validItems(SessionSchema, raw.sessions).slice(-MAX_SESSIONS),
    persona: { facts: parseFacts(persona.facts), ...(removed.length > 0 ? { removed } : {}) },
    ...(plan ? { plan } : {}),
    ...(supportCard ? { supportCard } : {}),
    ...(recap ? { recap } : {}),
  };
}
