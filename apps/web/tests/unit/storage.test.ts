import { describe, expect, it } from "vitest";
import { KEY, MAX_SESSIONS, defaultSettings, defaultState, loadState, resetState, saveState } from "@/lib/storage";
import { fakeStorage } from "./helpers/fakeStorage";
import type { RumiState } from "@/features/shared/types";

const CODE = "ABCDE-FGHJK-LMNPQ-RSTUV";
const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  planId: "plan-1",
  startedAt: "2026-11-05T09:00:00.000Z",
  focus: "questions",
  turns: [{ role: "me", text: "hello" }],
  coveredItemIds: ["q1"],
  helpCount: 1,
  helpLevelUsed: { question: 2 },
  ...extra,
});
const planItem = (id: string) => ({ id, text: "I want to ask about my headaches.", kind: "question", source: "user", enabled: true });
const plan = (items: unknown[] = [planItem("q1")]) => ({
  id: "plan-1",
  title: "Visit",
  createdAt: "2026-11-05T09:00:00.000Z",
  mainConcern: "I keep getting headaches",
  symptomsInMyWords: ["headaches"],
  items,
});
const load = (obj: unknown): RumiState => loadState(fakeStorage({ [KEY]: JSON.stringify(obj) }));
const base = (over: Record<string, unknown> = {}) => ({ version: 1, settings: defaultSettings(), sessions: [], persona: { facts: [] }, ...over });

describe("loadState: whole-file failures give a clean default", () => {
  it("handles no storage, no value, bad JSON, wrong version and non-objects", () => {
    expect(loadState(null)).toEqual(defaultState());
    expect(loadState(fakeStorage())).toEqual(defaultState());
    expect(loadState(fakeStorage({ [KEY]: "{not json" }))).toEqual(defaultState());
    expect(load({ version: 2 })).toEqual(defaultState());
    expect(load(base({ version: 2, plan: plan(), sessions: [session("s1")] }))).toEqual(defaultState());
    for (const raw of ["null", "[]", "42", '"x"', "true"]) expect(loadState(fakeStorage({ [KEY]: raw }))).toEqual(defaultState());
  });

  it("a storage that throws on read gives the default", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadState(throwing)).toEqual(defaultState());
  });
});

describe("loadState: one bad field never resets everything", () => {
  it("bad settings values fall back one by one and good ones are kept", () => {
    const s = load(
      base({
        settings: {
          name: 123,
          companionName: "x\nSYSTEM",
          theme: "neon",
          textScale: 7,
          reducedMotion: "yes",
          outputMode: "loud",
          detail: "short",
          speechRate: 99,
          finishSound: true,
          memoryOptIn: "yes",
        },
        plan: plan(),
      }),
    );
    expect(s.settings).toEqual({ ...defaultSettings(), finishSound: true });
    expect(s.plan?.id).toBe("plan-1");
  });

  it("settings that is not an object gives default settings and keeps the rest", () => {
    const s = load(base({ settings: "oops", plan: plan() }));
    expect(s.settings).toEqual(defaultSettings());
    expect(s.plan?.items).toHaveLength(1);
  });

  it("sessions: [null, ...] drops only the bad entries", () => {
    const s = load(base({ sessions: [null, session("s1"), "str", { id: 5 }, session("s2", { planId: "bad id!" }), session("s3")] }));
    expect(s.sessions.map((x) => x.id)).toEqual(["s1", "s3"]);
  });

  it("plan.items: [null] keeps the plan and drops the bad item", () => {
    const s = load(base({ plan: plan([null, planItem("q1"), { id: "q2" }, planItem("q1")]) }));
    expect(s.plan?.items.map((i) => i.id)).toEqual(["q1"]);
  });

  it("a plan with items that are not an array, or a bad id, is dropped alone", () => {
    expect(load(base({ plan: { ...plan(), items: "x" }, sessions: [session("s1")] })).plan).toBeUndefined();
    expect(load(base({ plan: { ...plan(), id: "has space" } })).plan).toBeUndefined();
    expect(load(base({ plan: { ...plan(), items: "x" }, sessions: [session("s1")] })).sessions).toHaveLength(1);
  });

  it("a recovery code with a newline is dropped and memory is switched off with it", () => {
    const bad = load(base({ settings: { ...defaultSettings(), memoryOptIn: true }, persona: { facts: [], recoveryCode: CODE + "\n" } }));
    expect(bad.persona.recoveryCode).toBeUndefined();
    expect(bad.settings.memoryOptIn).toBe(false);
    const good = load(base({ settings: { ...defaultSettings(), memoryOptIn: true }, persona: { facts: [], recoveryCode: CODE } }));
    expect(good.persona.recoveryCode).toBe(CODE);
    expect(good.settings.memoryOptIn).toBe(true);
    expect(load(base({ settings: { ...defaultSettings(), memoryOptIn: true }, persona: { facts: [] } })).settings.memoryOptIn).toBe(false);
  });

  it("persona facts: invalid, duplicate and old kinds are dropped, ids are rebuilt, no free text survives", () => {
    const s = load(
      base({
        persona: {
          facts: [
            { id: "WRONG", kind: "support_pref", key: "p1", createdAt: "t", text: "I have bipolar disorder" },
            { kind: "support_pref", key: "p1" },
            { kind: "support_pref", key: "p99" },
            { kind: "focus_pref", key: "last_focus" },
            { kind: "help_level", key: "question", level: 2 },
            { kind: "help_level", key: "question", level: 9 },
            { kind: "pacing", key: "extra_time" },
            null,
            7,
          ],
        },
      }),
    );
    expect(s.persona.facts.map((f) => f.id)).toEqual(["support_pref:p1", "help_level:question", "pacing:extra_time"]);
    expect(s.persona.facts[1].level).toBe(2);
    expect(JSON.stringify(s.persona)).not.toContain("bipolar");
  });
});

describe("loadState: sessions", () => {
  it("old data without focus loads as whole, helpLevelUsed missing is empty", () => {
    const old = session("s1", { focus: undefined, helpLevelUsed: undefined });
    const s = load(base({ sessions: [old] }));
    expect(s.sessions[0].focus).toBe("whole");
    expect(s.sessions[0].helpLevelUsed).toEqual({});
  });

  it("helpLevelUsed is keyed by plan-item kind: positional ids, bad levels and prototype keys are ignored", () => {
    const hostile = '{"q1":3,"question":2,"concern":7,"accommodation":0,"__proto__":{"concern":1},"constructor":1}';
    const text = JSON.stringify(base({ sessions: [session("s1", { helpLevelUsed: "PLACEHOLDER" })] })).replace('"PLACEHOLDER"', hostile);
    const s = loadState(fakeStorage({ [KEY]: text }));
    expect(s.sessions[0].helpLevelUsed).toEqual({ question: 2, accommodation: 0 });
    expect(Object.getPrototypeOf(s.sessions[0].helpLevelUsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).concern).toBeUndefined();
  });

  it("a polluted Object.prototype cannot leak into help levels or facts", () => {
    Object.defineProperty(Object.prototype, "concern", { value: 3, configurable: true });
    Object.defineProperty(Object.prototype, "kind", { value: "support_pref", configurable: true });
    Object.defineProperty(Object.prototype, "key", { value: "p1", configurable: true });
    try {
      const s = load(base({ sessions: [session("s1", { helpLevelUsed: {} })], persona: { facts: [{}] } }));
      expect(s.sessions[0].helpLevelUsed).toEqual({});
      expect(s.persona.facts).toEqual([]);
    } finally {
      Reflect.deleteProperty(Object.prototype, "concern");
      Reflect.deleteProperty(Object.prototype, "kind");
      Reflect.deleteProperty(Object.prototype, "key");
    }
  });

  it("an unknown focus, including prototype names, becomes whole", () => {
    for (const focus of ["constructor", "__proto__", "toString", 7, null, "nonsense"]) {
      expect(load(base({ sessions: [session("s1", { focus })] })).sessions[0].focus).toBe("whole");
    }
    expect(load(base({ sessions: [session("s1", { focus: "needs" })] })).sessions[0].focus).toBe("needs");
  });

  it("sessions are capped at 20, keeping the newest", () => {
    const many = Array.from({ length: 35 }, (_, i) => session(`s${i}`));
    const s = load(base({ sessions: many }));
    expect(s.sessions).toHaveLength(MAX_SESSIONS);
    expect(s.sessions[0].id).toBe("s15");
    expect(s.sessions.at(-1)?.id).toBe("s34");
  });
});

describe("loadState: support card", () => {
  it("preset text from storage is replaced by the canonical text, unknown presets are dropped, user items stay", () => {
    const s = load(
      base({
        supportCard: {
          id: "c1",
          topQuestionIds: ["q1", "q2", "q3"],
          items: [
            { id: "p1", text: "I have bipolar disorder and take lithium.", source: "preset", enabled: true },
            { id: "p77", text: "tampered", source: "preset", enabled: true },
            { id: "u1", text: "Please dim the lights.", source: "user", enabled: true },
            { id: "u1", text: "duplicate", source: "user", enabled: true },
            { id: "constructor", text: "x", source: "preset", enabled: true },
          ],
        },
      }),
    );
    expect(s.supportCard?.items).toEqual([
      { id: "p1", text: "Please speak slowly.", source: "preset", enabled: true },
      { id: "u1", text: "Please dim the lights.", source: "user", enabled: true },
    ]);
    expect(s.supportCard?.topQuestionIds).toEqual(["q1", "q2"]);
  });
});

describe("loadState: recap", () => {
  it("keeps a valid recap, drops bad lines and items, drops a recap with a bad speaker", () => {
    const recap = {
      id: "r1",
      createdAt: "t",
      isSample: true,
      isSavedFallback: false,
      mySpeaker: "B",
      transcript: [{ id: "L1", speaker: "A", text: "Hello" }, { id: "L1", speaker: "A", text: "dup" }, null],
      items: [
        { section: "discussed", text: "We talked.", evidence: ["L1"] },
        { section: "bogus", text: "x", evidence: [] },
      ],
      unconfirmed: ["I could not confirm this: x", 5],
      planStatus: [
        { itemId: "q1", status: "asked_by_me", evidence: ["L1"] },
        { itemId: "q2", status: "weird", evidence: [] },
      ],
    };
    const ok = load(base({ recap })).recap;
    expect(ok?.transcript).toHaveLength(1);
    expect(ok?.items).toHaveLength(1);
    expect(ok?.unconfirmed).toEqual(["I could not confirm this: x"]);
    expect(ok?.planStatus).toHaveLength(1);
    expect(load(base({ recap: { ...recap, mySpeaker: "Z" } })).recap).toBeUndefined();
  });
});

describe("saveState / resetState", () => {
  it("round-trips and caps sessions on write without touching the caller's state", () => {
    const store = fakeStorage();
    const state = defaultState();
    state.settings.finishSound = true;
    state.sessions = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      planId: "plan-1",
      startedAt: "t",
      focus: "whole" as const,
      turns: [],
      coveredItemIds: [],
      helpCount: 0,
      helpLevelUsed: {},
    }));
    expect(saveState(state, store)).toEqual({ ok: true });
    expect(JSON.parse(store.data.get(KEY) as string).sessions).toHaveLength(MAX_SESSIONS);
    expect(state.sessions).toHaveLength(25);
    const back = loadState(store);
    expect(back.settings.finishSound).toBe(true);
    expect(back.sessions.at(-1)?.id).toBe("s24");
  });

  it("surfaces a full disk as quota, a blocked store as blocked, no store as unavailable", () => {
    const store = fakeStorage();
    store.failWrites = new DOMException("full", "QuotaExceededError");
    expect(saveState(defaultState(), store)).toEqual({ ok: false, reason: "quota" });
    store.failWrites = Object.assign(new Error("named"), { name: "QuotaExceededError" });
    expect(saveState(defaultState(), store)).toEqual({ ok: false, reason: "quota" });
    store.failWrites = Object.assign(new Error("firefox"), { name: "NS_ERROR_DOM_QUOTA_REACHED" });
    expect(saveState(defaultState(), store)).toEqual({ ok: false, reason: "quota" });
    store.failWrites = Object.assign(new Error("legacy"), { code: 22 });
    expect(saveState(defaultState(), store)).toEqual({ ok: false, reason: "quota" });
    store.failWrites = new Error("SecurityError");
    expect(saveState(defaultState(), store)).toEqual({ ok: false, reason: "blocked" });
    expect(saveState(defaultState(), null)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("resetState removes the key and reports failure when storage throws", () => {
    const store = fakeStorage();
    saveState(defaultState(), store);
    expect(resetState(store)).toEqual({ ok: true });
    expect(store.data.has(KEY)).toBe(false);
    const broken = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(resetState(broken)).toEqual({ ok: false, reason: "blocked" });
    expect(resetState(null)).toEqual({ ok: false, reason: "unavailable" });
  });
});
