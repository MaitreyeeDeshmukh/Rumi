/**
 * POST /api/appointment/lookup. Body: {place, care}, the clinic as the person confirmed it. The server asks a model with web
 * search what that clinic tells patients to bring and when to arrive, and answers {found, items, sources}.
 * Each item is short model text with every link and unsafe line removed. Its link comes from server code (search.ts).
 * Same steps as the other routes: guardRequest (origin, signed-in user, a limit of 10 per 10 minutes) -> body cap -> Zod.
 * Any provider problem is one generic 503 `ai_unavailable`; the screen then keeps the generic list.
 */
import { LookupReply, LookupRequest, type LookupReplyT } from "@/features/shared/schemas";
import { LIMITS } from "@/features/shared/constants";
import type { EvidenceLedger } from "@/features/shared/task";
import { HttpError, errorResponse, json, readJson } from "@/lib/ai/http";
import { adviceCodes, stripUrls } from "@/lib/ai/guards/output";
import { estimateCostMicroUsd } from "@/lib/ai/cost";
import { promptForm } from "@/lib/ai/guards/input";
import { logEvent, type AiEvent } from "@/lib/ai/telemetry";
import { routeAuth } from "@/lib/auth/routeAuth";
import { mockAiEnabled } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { countWords } from "@/lib/literalLint";
import { guardRequest } from "@/lib/security/guardRequest";
import { createRateLimiter, type RateLimiter } from "@/lib/security/rateLimit";
import { searchBring } from "./search";
import { APPOINTMENT_LOOKUP_VERSION } from "../../../prompts/appointmentScan";

const lookupLimiter = createRateLimiter({ limits: { perIp: 10, perSession: 10, perInstance: 100, windowMs: 600_000 } });
const EMPTY_LEDGER: EvidenceLedger = { items: [], thin: false };
const MAX_ITEMS = 8;
const MAX_WORDS = 15;

export interface LookupHandlerDeps {
  fetchFn: typeof fetch;
  limiter?: RateLimiter;
  timeoutMs?: number;
}

/** Model text to a safe item: no links, one line, short, and no dose, diagnosis or treatment. Null when it cannot be kept. */
export function cleanItem(raw: string): string | null {
  const t = stripUrls(promptForm(raw)).replace(/\s+/g, " ").trim().replace(/^[-*•\d.)\s]+/, "");
  if (t.length < 3 || t.length > 160 || countWords(t) > MAX_WORDS || /[<>{}]/.test(t)) return null;
  return adviceCodes(t, EMPTY_LEDGER).length === 0 ? t : null;
}

function record(ev: Partial<AiEvent>, startedAt: number): void {
  logEvent({
    id: crypto.randomUUID(),
    task: "appointmentLookup",
    promptVersion: APPOINTMENT_LOOKUP_VERSION,
    outcome: "error",
    degraded: false,
    attempts: 0,
    tier: "none",
    redactions: 0,
    injectionHits: 0,
    thin: false,
    guardHits: [],
    memoryItems: 0,
    inTokens: 0,
    outTokens: 0,
    ms: Date.now() - startedAt,
    ...ev,
  });
}

export function createLookupHandler({ fetchFn, limiter = lookupLimiter, timeoutMs }: LookupHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const startedAt = Date.now();
    try {
      await guardRequest(req, { ...routeAuth(), maxBytes: 2_000, limiter });
      const parsed = LookupRequest.safeParse(await readJson(req, 2_000));
      if (!parsed.success) throw new HttpError(400, "bad_input");
      const place = promptForm(parsed.data.place).trim();
      if (place.length < 2 || place.length > LIMITS.rawTextMax) throw new HttpError(400, "bad_input");

      // A demo run with no AI: nothing is searched, so the screen shows the generic list.
      if (mockAiEnabled()) {
        record({ outcome: "mock" }, startedAt);
        return json({ found: false, items: [], sources: [] } satisfies LookupReplyT);
      }

      let read;
      try {
        read = await searchBring(place, parsed.data.care, { fetchFn, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
      } catch {
        record({ outcome: "fallback", degraded: true, errorCode: "ai_unavailable", providerKind: "http" }, startedAt);
        throw new HttpError(503, "ai_unavailable");
      }
      const seen = new Set<string>();
      const texts = read.out.found
        ? read.out.items
            .map((i) => cleanItem(i.text))
            .filter((t): t is string => t !== null && !seen.has(t.toLowerCase()) && (seen.add(t.toLowerCase()), true))
            .slice(0, MAX_ITEMS)
        : [];
      // Without a page to point to, an item is not offered: the person must be able to check it.
      const url = read.sources[0];
      const items = url === undefined ? [] : texts.map((text) => ({ text, url }));
      const reply = LookupReply.safeParse({ found: items.length > 0, items, sources: items.length > 0 ? read.sources : [] });
      if (!reply.success) throw new HttpError(503, "ai_unavailable");
      record(
        { outcome: "ok", attempts: 1, tier: "quality", inTokens: read.inTokens, outTokens: read.outTokens, costMicroUsd: estimateCostMicroUsd(read.model, read.inTokens, read.outTokens) },
        startedAt,
      );
      return json(reply.data);
    } catch (e) {
      return errorResponse(e instanceof AppError ? e : new HttpError(503, "ai_unavailable"));
    }
  };
}

export const lookupHandler = createLookupHandler({ fetchFn: (input, init) => fetch(input, init) });
