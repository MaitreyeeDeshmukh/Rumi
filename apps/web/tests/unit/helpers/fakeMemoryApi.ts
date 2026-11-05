import { createRemoteSync, createNamespaceQueue } from "@/features/memory/remoteSync";
import { forgetNamespace } from "@/features/memory/forgetAll";
import { createSmClient } from "@/features/memory/smClient";
import { isRecoveryCode } from "@/features/memory/recoveryCode";
import { tagFromCode } from "@/features/memory/tag";
import { FactsRequest } from "@/features/shared/schemas";
import { fakeSupermemory, type FakeSm } from "./fakeSupermemory";

export const TEST_SECRET = "x".repeat(40);

export interface ApiCall {
  path: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * A stand-in for the two memory routes, built from the real server-side pieces (tag, sync, forget) over the fake
 * Supermemory. Phase 4 writes the real routes; this lets the browser logic be tested against the same behaviour.
 */
export function fakeMemoryApi(sm: FakeSm = fakeSupermemory()) {
  const client = createSmClient({ fetchFn: sm.fetchFn, apiKey: "sm-key" });
  const queue = createNamespaceQueue();
  const sync = createRemoteSync(client, queue);
  const calls: ApiCall[] = [];
  let t = 0;
  const clock = { now: () => t, sleep: async (ms: number) => void (t += ms) };

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = String(init?.body ?? "");
    const path = String(input);
    calls.push({ path, headers, body });
    const code = headers["x-rumi-key"];
    if (!code || !isRecoveryCode(code)) return Response.json({ error: { code: "bad_input" } }, { status: 400 });
    const ns = tagFromCode(code, TEST_SECRET);
    if (path === "/api/memory/facts") {
      const parsed = FactsRequest.safeParse(JSON.parse(body));
      if (!parsed.success) return Response.json({ error: { code: "bad_input" } }, { status: 400 });
      const r = await sync.syncFacts(ns, parsed.data.facts);
      return Response.json({ saved: r.saved, rejected: r.rejected });
    }
    if (path === "/api/memory/forget") {
      return Response.json({ status: await forgetNamespace(ns, { client, queue, ...clock }) });
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;

  return { fetchFn, calls, sm };
}
