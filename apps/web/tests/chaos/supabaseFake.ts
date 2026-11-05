/**
 * A fake Supabase client for chaos tests. It answers any call chain (`from().select().eq()`, `rpc()`, `auth.getUser()`),
 * so a lane module can be tested without knowing which exact query it builds. Four modes:
 *   ok     answers from `flags`, `user` and `rpc`
 *   down   every call rejects, like an unreachable host (the error text carries ERR_MESSAGE)
 *   error  every call resolves { data: null, error } like a 5xx from PostgREST (also carries ERR_MESSAGE)
 *   hang   no call ever answers
 */
import { vi } from "vitest";
import { ERR_MESSAGE } from "./fakes";

export type Mode = "ok" | "down" | "error" | "hang";

export interface FakeSupabase {
  /** The object to hand out as the client. */
  client: unknown;
  mode: Mode;
  /** Value of each feature flag in `ok` mode. */
  flags: Record<string, boolean>;
  /** The signed-in user in `ok` mode, or null for no session. */
  user: { id: string; is_anonymous: boolean } | null;
  /** `rpc(name)` results in `ok` mode. */
  rpc: Record<string, unknown>;
  /** Every settled call as a dotted path, for example `from["ops_feature_flags"].select["key,enabled"]`. */
  calls: string[];
}

export function fakeSupabase(mode: Mode = "ok"): FakeSupabase {
  const f: FakeSupabase = {
    client: undefined,
    mode,
    flags: { ai_enabled: true, memory_sync_enabled: true, cloud_sync_enabled: true },
    user: { id: "11111111-2222-4333-8444-555555555555", is_anonymous: true },
    rpc: {},
    calls: [],
  };

  const settle = (path: string[]): Promise<unknown> => {
    const joined = path.join(".");
    f.calls.push(joined);
    if (f.mode === "hang") return new Promise(() => undefined);
    if (f.mode === "down") return Promise.reject(new TypeError(`fetch failed: ${ERR_MESSAGE}`));
    if (f.mode === "error") return Promise.resolve({ data: null, error: { message: ERR_MESSAGE, code: "57014", status: 500 } });
    if (/^auth\.getUser/.test(joined)) {
      return Promise.resolve(f.user ? { data: { user: f.user }, error: null } : { data: { user: null }, error: { message: "Auth session missing!", status: 401 } });
    }
    if (/^rpc\[/.test(joined)) {
      const name = /^rpc\[\["([^"]+)"/.exec(joined)?.[1] ?? "";
      return Promise.resolve({ data: f.rpc[name] ?? null, error: null });
    }
    if (/ops_feature_flags/.test(joined)) {
      const one = /(?:maybeSingle|single)/.test(joined);
      const key = /eq\[\["key","([a-z_]+)"\]/.exec(joined)?.[1];
      if (one && key !== undefined) return Promise.resolve({ data: key in f.flags ? { key, enabled: f.flags[key] } : null, error: null });
      return Promise.resolve({ data: Object.entries(f.flags).map(([k, enabled]) => ({ key: k, enabled })), error: null });
    }
    return Promise.resolve({ data: [], error: null });
  };

  const chain = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        // Only a finished call (the last segment is `name[args]`) is awaitable; the client and `auth` themselves are plain objects.
        if (prop === "then") return /\]$/.test(path[path.length - 1] ?? "") ? (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => settle(path).then(ok, bad) : undefined;
        if (typeof prop === "symbol") return undefined;
        return chain([...path, prop]);
      },
      apply(_t, _this, args: unknown[]) {
        const last = path[path.length - 1] ?? "";
        return chain([...path.slice(0, -1), `${last}[${JSON.stringify(args)}]`]);
      },
    });

  f.client = chain([]);
  return f;
}

/**
 * Makes `getAdminClient` and `getServerClient` hand out `fake.client`, and neutralises `server-only` and `next/server`'s `after`
 * (which throws outside a request). Call before `import()`-ing the lane module, after `vi.resetModules()`.
 * `afterRuns` collects the callbacks passed to `after()` so a test can run them (and see them fail) on purpose.
 */
export function installSupabase(fake: FakeSupabase): { afterRuns: (() => unknown)[] } {
  const afterRuns: (() => unknown)[] = [];
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/supabase/admin", () => ({ getAdminClient: () => fake.client }));
  vi.doMock("@/lib/supabase/server", () => ({ getServerClient: async () => fake.client }));
  vi.doMock("next/server", () => ({ after: (cb: () => unknown) => void afterRuns.push(cb) }));
  return { afterRuns };
}
