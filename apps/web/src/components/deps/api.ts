/**
 * TEMPORARY stand-in for Sujal's `@/lib/api/client` (callApi, contract 4.6).
 * Calls the real route first. Only while a route does not exist yet (404) does it answer
 * with a local made-up reply, so the UI can be clicked through before lane/features merges.
 * Swap in `deps/index.ts` once lane/memory merges.
 */
import type { z } from 'zod';
import type { ApiErrorCode, ApiResult, PlanItem, Turn, VisitPlan } from '@/features/shared/types';
import { SAVED_RECAP_REPLY } from './fixtures';

type ApiPath = '/api/plan' | '/api/practice' | '/api/sayit' | '/api/recap';

const UNREACHABLE = 'I could not reach the AI. Your work is saved. Try again.';

export async function callApi<Req, Reply>(
  path: ApiPath,
  body: Req,
  reply: z.ZodType<Reply>,
  opts?: { memoryCode?: string },
): Promise<ApiResult<Reply>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts?.memoryCode ? { 'x-rumi-key': opts.memoryCode } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: { code: 'ai_unavailable', message: UNREACHABLE } };
  }
  if (res.status === 404) return localMock(path, body, reply);
  let json: unknown;
  try { json = await res.json(); } catch { return { ok: false, error: { code: 'ai_invalid', message: UNREACHABLE } }; }
  if (json && typeof json === 'object' && 'crisis' in json && (json as { crisis: unknown }).crisis === true) return { ok: false, crisis: true };
  if (!res.ok) {
    const err = (json as { error?: { code?: ApiErrorCode; message?: string } }).error;
    return { ok: false, error: { code: err?.code ?? 'ai_unavailable', message: err?.message ?? UNREACHABLE } };
  }
  const parsed = reply.safeParse(json);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: { code: 'ai_invalid', message: UNREACHABLE } };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function localMock<Req, Reply>(path: ApiPath, body: Req, reply: z.ZodType<Reply>): Promise<ApiResult<Reply>> {
  await wait(500);
  const data = mockFor(path, body as unknown);
  const parsed = reply.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: { code: 'ai_invalid', message: UNREACHABLE } };
}

function mockFor(path: ApiPath, body: unknown): unknown {
  if (path === '/api/plan') {
    const { rawText } = body as { rawText: string };
    const first = rawText.split(/[.!?\n]/).map((s) => s.trim()).find(Boolean) ?? rawText.trim();
    const items: PlanItem[] = [
      { id: 'i1', text: first.slice(0, 200), kind: 'concern', source: 'user', enabled: true },
      { id: 'i2', text: 'What can I do when this happens?', kind: 'question', source: 'user', enabled: true },
      { id: 'i3', text: 'Please write down what I should do.', kind: 'accommodation', source: 'suggested', enabled: false },
    ];
    const plan: VisitPlan = { id: `plan-${Date.now()}`, title: 'My visit plan', createdAt: new Date().toISOString(), mainConcern: first.slice(0, 300), symptomsInMyWords: [first.slice(0, 100)], items };
    return { plan };
  }
  if (path === '/api/practice') {
    const { plan, turns } = body as { plan: VisitPlan; turns: Turn[] };
    const mine = turns.filter((t) => t.role === 'me').length;
    const lines = ['Hi, I am the practice clinician. What brings you in today?', 'Thank you. Can you tell me more about that?', 'Do you have any questions for me?', 'Is there anything that would help you at this visit?', 'Thank you. That is all for today.'];
    const enabled = plan.items.filter((i) => i.enabled);
    return { clinicianSay: lines[Math.min(mine, lines.length - 1)], coveredItemIds: enabled.slice(0, Math.max(0, mine)).map((i) => i.id), isLastTurn: mine >= 4 };
  }
  if (path === '/api/sayit') {
    const { level, scenario } = body as { level: 1 | 2 | 3; scenario?: string };
    const scripts: Record<string, string> = {
      book: 'Hello. I want to book an appointment. Do you have a time on [day]?',
      late: 'Hello. I have an appointment at [time]. I am running [number] minutes late.',
      repeat: 'Please say that again more slowly.',
      written: 'Please write down what I should do.',
      next: 'What should I do next?',
    };
    if (scenario) return { script: scripts[scenario] ?? scripts.next, blanks: (scripts[scenario] ?? '').match(/\[[^\]]+\]/g) ?? [] };
    if (level === 1) return { script: 'Say what bothers you most, in one sentence.', blanks: [] };
    if (level === 2) return { script: 'The main thing is [what bothers you]. It started [when].', blanks: ['[what bothers you]', '[when]'] };
    return { script: 'The main thing I want to talk about is my headaches.', blanks: [] };
  }
  return SAVED_RECAP_REPLY;
}
