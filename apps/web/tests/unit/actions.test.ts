import { describe, expect, it, vi } from "vitest";
import { createMemoryActions, memoryCodeFor } from "@/features/memory/actions";
import { isRecoveryCode } from "@/features/memory/recoveryCode";
import { tagFromCode } from "@/features/memory/tag";
import { createStateStore } from "@/features/state/stateStore";
import { KEY, defaultState, loadState } from "@/lib/storage";
import { fakeStorage } from "./helpers/fakeStorage";
import { TEST_SECRET, fakeMemoryApi } from "./helpers/fakeMemoryApi";
import type { RumiState, SupportItem } from "@/features/shared/types";

const CODE = "ABCDE-FGHJK-LMNPQ-RSTUV";
const preset = (id: string, enabled = true): SupportItem => ({ id, text: "x", source: "preset", enabled });

function setup(fetchFn: typeof fetch, mutate?: (s: RumiState) => void) {
  const storage = fakeStorage();
  const store = createStateStore({ storage });
  store.hydrate();
  store.update((d) => {
    d.supportCard = { id: "c", topQuestionIds: [], items: [preset("p1"), preset("p2"), preset("p5", false)] };
    mutate?.(d);
  });
  const actions = createMemoryActions({ store, fetchFn, now: () => "2026-11-05T10:00:00.000Z", timeoutMs: 500 });
  return { storage, store, actions, state: () => store.getSnapshot().state };
}
const ok = (body: unknown) => async () => Response.json(body);

describe("memoryCodeFor", () => {
  it("returns the code only while memory is on and the code is valid", () => {
    const s = defaultState();
    s.persona.recoveryCode = CODE;
    expect(memoryCodeFor(s)).toBeUndefined();
    s.settings.memoryOptIn = true;
    expect(memoryCodeFor(s)).toBe(CODE);
    s.persona.recoveryCode = CODE + "\n";
    expect(memoryCodeFor(s)).toBeUndefined();
    delete s.persona.recoveryCode;
    expect(memoryCodeFor(s)).toBeUndefined();
  });
});

describe("syncPersona with memory off", () => {
  it("saves facts on the device and makes no network call", async () => {
    const fetchFn = vi.fn(ok({ saved: 0, rejected: 0 }));
    const { actions, state, storage } = setup(fetchFn as unknown as typeof fetch);
    expect(await actions.syncPersona()).toEqual({ saved: 3, remote: "off" });
    expect(fetchFn).not.toHaveBeenCalled();
    const ids = ["support_pref:p1", "support_pref:p2", "pacing:one_question"];
    expect(state().persona.facts.map((f) => f.id)).toEqual(ids);
    expect(loadState(storage).persona.facts.map((f) => f.id)).toEqual(ids);
  });
});

describe("enableMemory", () => {
  it("creates a valid code once, keeps it on a second call, and posts the wire facts with the header", async () => {
    const api = fakeMemoryApi();
    const { actions, state } = setup(api.fetchFn);
    const first = await actions.enableMemory();
    expect(first).toEqual({ ok: true, remote: "ok" });
    const code = state().persona.recoveryCode as string;
    expect(isRecoveryCode(code)).toBe(true);
    expect(state().settings.memoryOptIn).toBe(true);
    await actions.enableMemory();
    expect(state().persona.recoveryCode).toBe(code);
    const call = api.calls[0];
    expect(call.path).toBe("/api/memory/facts");
    expect(call.headers["x-rumi-key"]).toBe(code);
    expect(JSON.parse(call.body)).toEqual({
      facts: [
        { kind: "support_pref", key: "p1" },
        { kind: "support_pref", key: "p2" },
        { kind: "pacing", key: "one_question" },
      ],
    });
  });

  it("does not switch memory on when the code cannot be saved on this device, and sends nothing", async () => {
    const fetchFn = vi.fn(ok({ saved: 0, rejected: 0 }));
    const { actions, state, storage } = setup(fetchFn as unknown as typeof fetch);
    storage.failWrites = new DOMException("full", "QuotaExceededError");
    expect(await actions.enableMemory()).toEqual({ ok: false, remote: "failed" });
    expect(state().settings.memoryOptIn).toBe(false);
    expect(state().persona.recoveryCode).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("syncPersona with memory on", () => {
  it("a failing, rejecting or malformed answer is `failed`, and local facts are still saved", async () => {
    for (const fetchFn of [
      async () => new Response("no", { status: 500 }),
      async () => Promise.reject(new Error("net")),
      ok({ unexpected: true }),
      async () => new Response("not json", { status: 200 }),
    ]) {
      const { actions, state } = setup(fetchFn as unknown as typeof fetch);
      const r = await actions.enableMemory();
      expect(r.remote).toBe("failed");
      expect(state().persona.facts.length).toBeGreaterThan(0);
      expect(state().settings.memoryOptIn).toBe(true);
    }
  });

  it("an error status counts as failed even when its body looks like a good answer", async () => {
    const bad = (async () => Response.json({ saved: 1, rejected: 0 }, { status: 500 })) as typeof fetch;
    const { actions } = setup(bad);
    expect((await actions.enableMemory()).remote).toBe("failed");
    const badForget = (async () => Response.json({ status: "ok" }, { status: 500 })) as typeof fetch;
    const second = setup(badForget);
    second.store.update((d) => void (d.persona.recoveryCode = CODE));
    expect(await second.actions.forgetAll()).toEqual({ remote: "failed" });
  });

  it("times out instead of hanging", async () => {
    const hang = ((_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))))) as typeof fetch;
    const { actions } = setup(hang);
    expect((await actions.enableMemory()).remote).toBe("failed");
  });

  it("a sync that re-saves the code to storage may go ahead", async () => {
    const api = fakeMemoryApi();
    const { actions, storage } = setup(api.fetchFn);
    await actions.enableMemory();
    const raw = JSON.parse(storage.data.get(KEY) as string);
    delete raw.persona.recoveryCode;
    storage.data.set(KEY, JSON.stringify(raw));
    expect((await actions.syncPersona()).remote).toBe("ok");
    expect(JSON.parse(storage.data.get(KEY) as string).persona.recoveryCode).toBeDefined();
  });

  it("does not write remotely when the code can no longer be read back from storage", async () => {
    const api = fakeMemoryApi();
    const { actions, storage } = setup(api.fetchFn);
    await actions.enableMemory();
    const before = api.calls.length;
    const raw = JSON.parse(storage.data.get(KEY) as string);
    raw.persona.recoveryCode = "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ";
    storage.data.set(KEY, JSON.stringify(raw));
    storage.failWrites = new DOMException("full", "QuotaExceededError");
    expect((await actions.syncPersona()).remote).toBe("failed");
    expect(api.calls.length).toBe(before);
  });

  it("turning a preference off sends the shorter list, so the server can remove it remotely", async () => {
    const api = fakeMemoryApi();
    const { actions, store } = setup(api.fetchFn);
    await actions.enableMemory();
    const ns = tagFromCode(store.getSnapshot().state.persona.recoveryCode as string, TEST_SECRET);
    expect(api.sm.docs(ns).size).toBe(3);
    store.update((d) => void (d.supportCard = { id: "c", topQuestionIds: [], items: [preset("p1"), preset("p2", false)] }));
    await actions.syncPersona();
    expect([...api.sm.docs(ns).keys()]).toEqual(["support_pref:p1"]);
    store.update((d) => void (d.supportCard = { id: "c", topQuestionIds: [], items: [preset("p1", false)] }));
    await actions.syncPersona();
    expect(JSON.parse(api.calls.at(-1)?.body ?? "{}")).toEqual({ facts: [] });
    expect(api.sm.docs(ns).size).toBe(0);
  });

  it("two quick syncs run one after the other", async () => {
    let inFlight = 0;
    let max = 0;
    const slow = (async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return Response.json({ saved: 1, rejected: 0 });
    }) as typeof fetch;
    const { actions } = setup(slow);
    await actions.enableMemory();
    await Promise.all([actions.syncPersona(), actions.syncPersona(), actions.syncPersona()]);
    expect(max).toBe(1);
  });
});

describe("disableMemory", () => {
  it("switches memory off, keeps the code and the facts, and never calls the server", async () => {
    const api = fakeMemoryApi();
    const { actions, state } = setup(api.fetchFn);
    await actions.enableMemory();
    const code = state().persona.recoveryCode;
    const calls = api.calls.length;
    await actions.disableMemory();
    expect(state().settings.memoryOptIn).toBe(false);
    expect(state().persona.recoveryCode).toBe(code);
    expect(state().persona.facts.length).toBeGreaterThan(0);
    expect(api.calls.length).toBe(calls);
    expect(await actions.syncPersona()).toMatchObject({ remote: "off" });
    expect(api.calls.length).toBe(calls);
  });
});

describe("forgetAll and deleteEverything", () => {
  it("forget removes the remote copy, then clears the code, the switch and the facts", async () => {
    const api = fakeMemoryApi();
    const { actions, state, store } = setup(api.fetchFn);
    await actions.enableMemory();
    const ns = tagFromCode(state().persona.recoveryCode as string, TEST_SECRET);
    expect(api.sm.docs(ns).size).toBe(3);
    expect(await actions.forgetAll()).toEqual({ remote: "ok" });
    expect(api.sm.docs(ns).size).toBe(0);
    expect(state().persona).toEqual({ facts: [] });
    expect(state().settings.memoryOptIn).toBe(false);
    expect(store.getSnapshot().state.supportCard).toBeDefined();
    const forget = api.calls.at(-1);
    expect(forget?.path).toBe("/api/memory/forget");
    expect(forget?.body).toBe("{}");
  });

  it("when the server says failed, the code, the switch and the facts stay", async () => {
    const api = fakeMemoryApi();
    const { actions, state } = setup(api.fetchFn);
    await actions.enableMemory();
    const ns = tagFromCode(state().persona.recoveryCode as string, TEST_SECRET);
    api.sm.stuckIds.add("support_pref:p1");
    const code = state().persona.recoveryCode;
    expect(await actions.forgetAll()).toEqual({ remote: "failed" });
    expect(state().persona.recoveryCode).toBe(code);
    expect(state().settings.memoryOptIn).toBe(true);
    expect(state().persona.facts.length).toBeGreaterThan(0);
    expect(api.sm.docs(ns).has("support_pref:p1")).toBe(true);
  });

  it("an error, a bad answer or a timeout is failed too", async () => {
    for (const fetchFn of [async () => new Response("x", { status: 500 }), ok({ status: "maybe" }), ok({}), async () => Promise.reject(new Error("net"))]) {
      const { actions, state, store } = setup(fetchFn as unknown as typeof fetch);
      store.update((d) => {
        d.persona.recoveryCode = CODE;
        d.settings.memoryOptIn = true;
      });
      expect(await actions.forgetAll()).toEqual({ remote: "failed" });
      expect(state().persona.recoveryCode).toBe(CODE);
    }
  });

  it("with no code there is nothing remote: local facts are cleared and remote is off", async () => {
    const fetchFn = vi.fn(ok({ status: "ok" }));
    const { actions, state } = setup(fetchFn as unknown as typeof fetch);
    await actions.syncPersona();
    expect(state().persona.facts.length).toBeGreaterThan(0);
    expect(await actions.forgetAll()).toEqual({ remote: "off" });
    expect(state().persona.facts).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("delete everything after switching memory off still calls forget when a code exists", async () => {
    const api = fakeMemoryApi();
    const { actions, state, storage } = setup(api.fetchFn);
    await actions.enableMemory();
    const ns = tagFromCode(state().persona.recoveryCode as string, TEST_SECRET);
    await actions.disableMemory();
    expect(await actions.deleteEverything()).toEqual({ status: "ok" });
    expect(api.calls.some((c) => c.path === "/api/memory/forget")).toBe(true);
    expect(api.sm.docs(ns).size).toBe(0);
    expect(storage.data.has(KEY)).toBe(false);
    expect(state()).toEqual(defaultState());
  });

  it("delete everything does not reset the device when forget failed", async () => {
    const api = fakeMemoryApi();
    const { actions, state, storage } = setup(api.fetchFn);
    await actions.enableMemory();
    api.sm.stuckIds.add("support_pref:p2");
    expect(await actions.deleteEverything()).toEqual({ status: "failed" });
    expect(storage.data.has(KEY)).toBe(true);
    expect(state().persona.recoveryCode).toBeDefined();
    expect(state().supportCard).toBeDefined();
  });

  it("delete everything with no code resets the device without any request", async () => {
    const fetchFn = vi.fn(ok({ status: "ok" }));
    const { actions, state } = setup(fetchFn as unknown as typeof fetch);
    expect(await actions.deleteEverything()).toEqual({ status: "ok" });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(state()).toEqual(defaultState());
  });

  it("if the device cannot be reset, delete everything says failed", async () => {
    const fetchFn = vi.fn(ok({ status: "ok" }));
    const { actions, storage } = setup(fetchFn as unknown as typeof fetch);
    storage.removeItem = () => {
      throw new Error("blocked");
    };
    expect(await actions.deleteEverything()).toEqual({ status: "failed" });
  });
});

describe("privacy end to end", () => {
  it("custom lines, plan text and symptoms never reach the network, and the code never reaches Supermemory", async () => {
    const api = fakeMemoryApi();
    const { actions, state } = setup(api.fetchFn, (s) => {
      s.settings.name = "Priya Raman";
      s.supportCard?.items.push(
        { id: "u1", text: "I have bipolar disorder and take lithium.", source: "user", enabled: true },
        { id: "p3", text: "I have bipolar disorder and take lithium.", source: "preset", enabled: true },
      );
      s.plan = {
        id: "plan-1",
        title: "HIV test",
        createdAt: "",
        mainConcern: "I want an HIV test and I take sertraline",
        symptomsInMyWords: ["panic attacks"],
        items: [{ id: "q1", text: "Can I stop sertraline?", kind: "question", source: "user", enabled: true }],
      };
      s.sessions = [{ id: "s1", planId: "plan-1", startedAt: "", focus: "whole", turns: [{ role: "me", text: "panic attacks" }], coveredItemIds: [], helpCount: 0, helpLevelUsed: { question: 2 } }];
    });
    await actions.enableMemory();
    await actions.syncPersona();
    const code = state().persona.recoveryCode as string;
    const toOurApi = JSON.stringify(api.calls.map((c) => c.body));
    const toSupermemory = JSON.stringify(api.sm.calls);
    for (const text of [toOurApi, toSupermemory, JSON.stringify([...api.sm.store.values()].map((m) => [...m.values()]))]) {
      expect(text).not.toMatch(/bipolar|lithium|sertraline|HIV|panic|Priya|Raman/i);
    }
    expect(toSupermemory).not.toContain(code);
    expect(toSupermemory).not.toContain(tagFromCode(code, TEST_SECRET).slice(2).toUpperCase());
    const ns = tagFromCode(code, TEST_SECRET);
    expect(api.sm.docs(ns).get("support_pref:p3")?.content).toBe("Please write down instructions for me.");
    expect(api.sm.docs(ns).get("help_level:question")?.content).toBe("When I practice asking my questions, I needed a sentence with blanks last time.");
    expect(api.sm.docs(ns).has("support_pref:u1")).toBe(false);
  });

  it("tampered preset text in localStorage cannot change what is synced", async () => {
    const api = fakeMemoryApi();
    const storage = fakeStorage();
    const tampered = {
      ...defaultState(),
      supportCard: { id: "c", topQuestionIds: [], items: [{ id: "p1", text: "I have bipolar disorder and take lithium.", source: "preset", enabled: true }] },
    };
    storage.data.set(KEY, JSON.stringify(tampered));
    const store = createStateStore({ storage });
    store.hydrate();
    const actions = createMemoryActions({ store, fetchFn: api.fetchFn });
    await actions.enableMemory();
    const ns = tagFromCode(store.getSnapshot().state.persona.recoveryCode as string, TEST_SECRET);
    expect(api.sm.docs(ns).get("support_pref:p1")?.content).toBe("Please speak slowly.");
    expect(JSON.stringify(api.sm.calls) + JSON.stringify(api.calls)).not.toMatch(/bipolar|lithium/);
  });
});
