// Server only. The logic behind POST /api/memory/facts and /api/memory/forget.
// The route files wrap these in Rudheer's guards (assertSameOrigin -> session + allowRequest -> readJson)
// and add Cache-Control: no-store. Nothing here logs the body, the header or the facts.
import { z } from 'zod';
import type { ApiErrorCode, PersonaFact } from '@/features/shared/types';
import { MAX_FACTS } from './persona';
import { isRecoveryCode } from './recoveryCode';
import { deriveTag } from './tag';
import type { MemoryStore } from './types';

export interface HandlerResult { status: number; body: unknown }
export interface HandlerDeps {
  store: () => MemoryStore | null;
  secret: string | undefined;
  sanitizeFact: (f: PersonaFact) => PersonaFact | null;
}

const fail = (status: number, code: ApiErrorCode, message: string): HandlerResult => ({ status, body: { error: { code, message } } });
const OFF = () => fail(503, 'ai_unavailable', 'Memory is not available right now. Your settings stay on this device.');

export const FactsBody = z.object({ facts: z.array(z.unknown()).max(MAX_FACTS) });
export const FACT_ID = /^[a-z_]+:[a-z0-9_-]{1,40}$/i;
export const ForgetBody = z.object({ factIds: z.array(z.string().regex(FACT_ID)).max(MAX_FACTS) });

export function createMemoryHandlers(deps: HandlerDeps) {
  /** Checks shared by both routes, in order: key format, then configuration. */
  function setup(code: string | null): { tag: string; store: MemoryStore } | HandlerResult {
    if (!isRecoveryCode(code)) return fail(400, 'bad_input', 'The memory code is missing or not valid.');
    const store = deps.store();
    if (!store || !deps.secret) return OFF();
    return { tag: deriveTag(code, deps.secret), store };
  }

  async function saveFacts(code: string | null, raw: unknown): Promise<HandlerResult> {
    const s = setup(code);
    if ('status' in s) return s;
    const parsed = FactsBody.safeParse(raw);
    if (!parsed.success) return fail(400, 'bad_input', `Send at most ${MAX_FACTS} facts.`);
    const valid = parsed.data.facts.map((f) => deps.sanitizeFact(f as PersonaFact)).filter((f): f is PersonaFact => !!f);
    try {
      if (valid.length) await s.store.upsertFacts(s.tag, valid);
    } catch {
      return OFF();
    }
    return { status: 200, body: { saved: valid.length, rejected: parsed.data.facts.length - valid.length } };
  }

  async function forgetFacts(code: string | null, raw: unknown): Promise<HandlerResult> {
    const s = setup(code);
    if ('status' in s) return s;
    const parsed = ForgetBody.safeParse(raw);
    if (!parsed.success) return fail(400, 'bad_input', 'Those memory ids are not valid.');
    try {
      await s.store.forget(s.tag, parsed.data.factIds);
    } catch {
      return OFF();
    }
    return { status: 200, body: { forgotten: parsed.data.factIds.length } };
  }

  return { saveFacts, forgetFacts };
}
