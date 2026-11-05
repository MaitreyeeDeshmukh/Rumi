import { createMemoryActions, type AuthStatus } from "@/features/memory/actions";
import { handleConsent, handleFacts, handleForget, type RouteDeps } from "@/features/memory/server";
import type { PracticeSession, SupportItem } from "@/features/shared/types";
import { createStateStore } from "@/features/state/stateStore";
import { readJson } from "@/lib/ai/http";
import type { FakeMemoryDb } from "./fakeMemoryDb";
import { fakeStorage } from "./fakeStorage";

export const SERVER_NOW = Date.parse("2026-11-05T12:00:00.000Z");
export const preset = (id: string, enabled = true): SupportItem => ({ id, text: "x", source: "preset", enabled });
export const practice = (id: string, startedAt: string, helpLevelUsed: PracticeSession["helpLevelUsed"]): PracticeSession => ({
  id,
  planId: "plan-1",
  startedAt,
  focus: "whole",
  turns: [],
  coveredItemIds: [],
  helpCount: 0,
  helpLevelUsed,
});

export interface DeviceOptions {
  card?: SupportItem[];
  auth?: AuthStatus;
  /** Client clock for new facts. */
  at?: string;
  hydrate?: boolean;
  attempts?: number;
}

/**
 * One browser: a real state store and the real memory actions, talking to the real route handlers over a shared fake
 * database. `answers` is a queue of replies that take the place of the route for the next calls (a Response, or "throw"
 * for a network failure, or null to let the call through).
 */
export function memoryDevice(db: FakeMemoryDb, options: DeviceOptions = {}) {
  const storage = fakeStorage();
  const store = createStateStore({ storage });
  if (options.hydrate !== false) store.hydrate();
  if (options.card) store.update((d) => void (d.supportCard = { id: "c", topQuestionIds: [], items: options.card ?? [] }));

  const flag = { on: true };
  const deps: RouteDeps = {
    guard: () => undefined,
    requireUser: async () => ({ userId: "u1" }),
    getDb: async () => db,
    getFlag: async () => flag.on,
    readJson,
    now: () => SERVER_NOW,
  };
  const auth = { status: options.auth ?? ("ready" as AuthStatus) };
  const clock = { at: options.at ?? "2026-11-05T10:00:00.000Z" };
  const calls: { path: string; body: unknown }[] = [];
  const sleeps: number[] = [];
  const answers: (Response | "throw" | null)[] = [];

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    calls.push({ path, body: JSON.parse(String(init?.body ?? "null")) });
    const next = answers.shift();
    if (next === "throw") throw new TypeError("Failed to fetch");
    if (next) return next;
    const req = new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: String(init?.body ?? "") });
    if (path === "/api/memory/facts") return handleFacts(req, deps);
    if (path === "/api/memory/forget") return handleForget(req, deps);
    if (path === "/api/memory/consent") return handleConsent(req, deps);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  const actions = createMemoryActions({
    store,
    fetchFn,
    authStatus: () => auth.status,
    now: () => clock.at,
    attempts: options.attempts ?? 3,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
  });
  return { storage, store, actions, flag, auth, clock, calls, sleeps, answers, state: () => store.getSnapshot().state };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
