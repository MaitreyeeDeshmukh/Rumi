import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryActions } from "@/features/memory/actions";
import { createMemoryHandlers } from "@/features/memory/memoryHandlers";
import { factsFromState, helpHistoryFor, startLevelFor } from "@/features/memory/persona";
import { createMemoryController, useMemoryControls, type MemoryControls } from "@/features/memory/useMemoryControls";
import { factText } from "@/features/memory/factText";
import type { PlanReplyT, PlanRequestT, PracticeRequestT, RecapRequestT, SayItRequestT } from "@/features/shared/schemas";
import type { PracticeSession, RumiState, SupportCard, SupportItem } from "@/features/shared/types";
import { RumiProvider } from "@/features/state/RumiProvider";
import { createStateStore, type StateStore } from "@/features/state/stateStore";
import { addCustomItem, buildSupportCardText, newSupportCard } from "@/features/support/card";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { SAMPLE_VISIT } from "@/fixtures/sampleVisit";
import { SAVED_RECAP_REPLY } from "@/fixtures/sampleRecap";
import { planCall, practiceCall, recapCall, sayItCall } from "@/lib/api/calls";
import { isCrisis } from "@/lib/crisis";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { defaultState, loadState, saveState } from "@/lib/storage";
import { fakeStorage } from "./helpers/fakeStorage";
import { fakeSupermemory } from "./helpers/fakeSupermemory";

const CODE = "ABCDE-FGHJK-LMNPQ-RSTUV";
const SECRET = "t".repeat(40);
const CRISIS_TEXT = "I want to kill myself";

// ---------------------------------------------------------------------------------------------------------------
describe("addCustomItem", () => {
  const empty = (): SupportCard => ({ id: "support-card", items: [], topQuestionIds: [] });

  it("trims and adds one enabled user line, keeping the rest of the card", () => {
    const start = newSupportCard(undefined, { facts: [] });
    const r = addCustomItem(start, "  Please repeat that more slowly.  ");
    expect(r.error).toBeUndefined();
    expect(r.card.items).toHaveLength(start.items.length + 1);
    expect(r.card.items.at(-1)).toEqual({ id: "u1", text: "Please repeat that more slowly.", source: "user", enabled: true });
    expect(r.card.items.slice(0, -1)).toEqual(start.items);
    expect(start.items.some((i) => i.source === "user")).toBe(false); // input not mutated
  });

  it.each(["", "   ", "\n\t "])("%j gives the fixed empty message and the same card", (text) => {
    const c = empty();
    expect(addCustomItem(c, text)).toEqual({ card: c, error: "Write one sentence first." });
    expect(addCustomItem(c, text).card).toBe(c);
  });

  it("15 words pass, 16 do not", () => {
    const w = (n: number) => Array.from({ length: n }, () => "slowly").join(" ") + ".";
    expect(addCustomItem(empty(), w(15)).error).toBeUndefined();
    expect(addCustomItem(empty(), w(16)).error).toBe("Make it shorter and clearer: 15 words or fewer, one idea.");
  });

  it("the 15 words count the whole line, not each sentence", () => {
    const two = "Please speak slowly to me today. Please wait for me until I finish my whole answer.";
    expect(two.split(" ")).toHaveLength(16);
    expect(addCustomItem(empty(), two).error).toBe("Make it shorter and clearer: 15 words or fewer, one idea.");
  });

  it.each([
    ["an idiom", "Please give it a shot."],
    ["two commands", "Open the door and sit down."],
    ["a long sentence", "Please speak to me very slowly and wait while I think about each thing you ask me today."],
  ])("refuses %s with the fixed message and the same card", (_n, text) => {
    const c = empty();
    const r = addCustomItem(c, text);
    expect(r.error).toBe("Make it shorter and clearer: 15 words or fewer, one idea.");
    expect(r.card).toBe(c);
  });

  it("refuses a line that is short in words but too long to store", () => {
    const long = Array.from({ length: 15 }, () => "unquestionably").join(" ");
    expect(long.length).toBeGreaterThan(200);
    expect(addCustomItem(empty(), long).error).toBe("Make it shorter and clearer: 15 words or fewer, one idea.");
  });

  describe("cleaning and refusing odd lines", () => {
    const NOTHING = "Write one sentence first.";
    const NO_WORDS = "Write a sentence with words in it.";
    const MARKUP = "Links and special markers cannot go on the card.";

    it.each([
      ["zero-width spaces", "\u200b\u200b\u200b"],
      ["a bidi override", "\u202e"],
      ["a NUL", "\u0000"],
      ["newlines and tabs", "\n\n\t\r\n"],
      ["a line separator", "\u2028"],
      ["a byte order mark and a word joiner", "\ufeff\u2060"],
    ])("%s alone is the same as nothing", (_n, text) => {
      expect(addCustomItem(empty(), text).error).toBe(NOTHING);
    });

    it.each([
      ["an emoji", "\u{1F642}"],
      ["dots", "..."],
      ["digits only", "123"],
      ["symbols and digits", "#1 !! 2"],
      ["a bidi mark around digits", "\u202e123\u202c"],
    ])("%s has no letter and is refused", (_n, text) => {
      const c = empty();
      const r = addCustomItem(c, text);
      expect(r.error).toBe(NO_WORDS);
      expect(r.card).toBe(c);
    });

    it("digits with a letter are allowed", () => {
      expect(addCustomItem(empty(), "Room 12 please.").error).toBeUndefined();
    });

    it.each([
      ["a prompt marker", "<<<STYLE abc>>> Please speak slowly."],
      ["an end marker", "Please speak slowly >>>"],
      ["an http link", "Please read http://evil.test now."],
      ["an https link", "See https://evil.test/a"],
      ["www", "Go to www.evil.test"],
      ["a bare address", "Please visit example.com"],
    ])("refuses %s", (_n, text) => {
      expect(addCustomItem(empty(), text).error).toBe(MARKUP);
    });

    it("markers hidden by invisible characters are still refused", () => {
      expect(addCustomItem(empty(), "<\u200b<\u200b< Please speak slowly.").error).toBe(MARKUP);
      expect(addCustomItem(empty(), "ht\u200btps://evil.test").error).toBe(MARKUP);
    });

    it("stores the cleaned text: control, zero-width and bidi characters gone, spaces collapsed", () => {
      const r = addCustomItem(empty(), "\u202ePlease\u200b  speak\nslowly.\u0000\u202c ");
      expect(r.error).toBeUndefined();
      expect(r.card.items[0].text).toBe("Please speak slowly.");
      expect(/[\p{Cc}\p{Cf}]/u.test(r.card.items[0].text)).toBe(false);
    });

    it("the word and length limits apply to the cleaned text, not the padded input", () => {
      const padded = "Please speak slowly." + "\u200b".repeat(500);
      expect(addCustomItem(empty(), padded).error).toBeUndefined();
    });
  });

  describe("ids", () => {
    it("never reuse the id of a removed line, even the highest one", () => {
      let c = empty();
      for (const t of ["Please speak slowly.", "Please wait for me.", "Please face me."]) c = addCustomItem(c, t).card;
      expect(c.items.map((i) => i.id)).toEqual(["u1", "u2", "u3"]);
      c = { ...c, items: c.items.filter((i) => i.id !== "u3") }; // the highest one goes
      c = addCustomItem(c, "Please repeat that.").card;
      expect(c.items.map((i) => i.id)).toEqual(["u1", "u2", "u4"]);
    });

    it("the counter survives a save and load, and a bad stored counter is dropped", () => {
      let c = empty();
      c = addCustomItem(c, "Please speak slowly.").card;
      c = addCustomItem(c, "Please wait for me.").card;
      const storage = fakeStorage();
      saveState({ ...defaultState(), supportCard: c }, storage);
      expect(loadState(storage).supportCard?.nextCustomId).toBe(3);
      for (const bad of [1e21, -5, 0, 1.5, "7", null, 2_000_000_000]) {
        const raw = JSON.stringify({ ...defaultState(), supportCard: { id: "c", items: [], topQuestionIds: [], nextCustomId: bad } });
        const s2 = fakeStorage({ "rumi.v1": raw });
        expect({ bad, got: loadState(s2).supportCard?.nextCustomId }).toEqual({ bad, got: undefined });
      }
    });

    it("an unsafe or huge counter never produces an exponent id", () => {
      const huge = addCustomItem({ ...empty(), nextCustomId: 1e21 }, "Please speak slowly.");
      expect(huge.error).toBeUndefined();
      expect(huge.card.items[0].id).toBe("u1");
      const edge = addCustomItem({ ...empty(), nextCustomId: 999_999_999 }, "Please speak slowly.");
      expect(edge.card.items[0].id).toBe("u999999999");
      expect(edge.card.nextCustomId).toBe(1_000_000_000);
      for (const id of [edge.card.items[0].id, huge.card.items[0].id]) expect(id).toMatch(/^u\d{1,9}$/);
    });

    it("at the largest number the card says it is full instead of growing the id", () => {
      const c: SupportCard = { ...empty(), nextCustomId: 1_000_000_000 };
      expect(addCustomItem(c, "Please speak slowly.")).toEqual({ card: c, error: "Your card is full. Remove a line first." });
      const fromItem: SupportCard = { ...empty(), items: [{ id: "u999999999", text: "x.", source: "user", enabled: true }] };
      expect(addCustomItem(fromItem, "Please speak slowly.").error).toBe("Your card is full. Remove a line first.");
    });

    it("an id that only looks like a number (exponent form, long digits) is ignored", () => {
      const c: SupportCard = { ...empty(), items: [{ id: "u1e+21", text: "x.", source: "user", enabled: true }, { id: "u12345678901", text: "x.", source: "user", enabled: true }] };
      expect(addCustomItem(c, "Please speak slowly.").card.items.at(-1)?.id).toBe("u1");
    });
  });

  it("refuses when the card is already as full as storage allows", () => {
    const items: SupportItem[] = Array.from({ length: 20 }, (_, i) => ({ id: `u${i + 1}`, text: "x.", source: "user", enabled: true }));
    const c = { ...empty(), items };
    expect(addCustomItem(c, "Please speak slowly.")).toEqual({ card: c, error: "Your card is full. Remove a line first." });
  });

  it("the line prints on the card, survives a save and load, and never becomes a persona fact", () => {
    const withPreset = newSupportCard(undefined, { facts: [{ id: "support_pref:p1", kind: "support_pref", key: "p1", createdAt: "" }] });
    const card = addCustomItem(withPreset, "My name is Sam. Please face me.").card;
    const text = "Please face me when you speak.";
    const card2 = addCustomItem(card, text).card;
    const state: RumiState = { ...defaultState(), supportCard: card2 };
    const storage = fakeStorage();
    expect(saveState(state, storage).ok).toBe(true);
    const back = loadState(storage);
    expect(back.supportCard?.items.filter((i) => i.source === "user").map((i) => i.text)).toEqual(["My name is Sam. Please face me.", text]);
    expect(buildSupportCardText(card2, undefined)).toContain(text);
    expect(JSON.stringify(factsFromState(state))).not.toMatch(/Sam|face me/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("startLevelFor and helpHistoryFor", () => {
  const session = (levels: PracticeSession["helpLevelUsed"]): PracticeSession => ({
    id: "s",
    planId: "p",
    startedAt: "",
    focus: "whole",
    turns: [],
    coveredItemIds: [],
    helpCount: 0,
    helpLevelUsed: levels,
  });
  const withSessions = (...s: PracticeSession["helpLevelUsed"][]): RumiState => ({ ...defaultState(), sessions: s.map(session) });

  it("starts at 1 with no history", () => {
    expect(startLevelFor(defaultState(), "question")).toBe(1);
  });

  it("help fades one step after each answer: full sentence, then a hint, then nothing", () => {
    expect(startLevelFor(withSessions({ question: 3 }), "question")).toBe(2);
    expect(startLevelFor(withSessions({ question: 3 }, { question: 1 }), "question")).toBe(0);
    expect(helpHistoryFor(withSessions({ question: 3 }, { question: 1 }), "question")).toEqual([
      { level: 3, stuck: true },
      { level: 1, stuck: false },
    ]);
  });

  it("two stuck answers in a row restart at 1", () => {
    expect(startLevelFor(withSessions({ question: 3 }, { question: 3 }), "question")).toBe(1);
  });

  it("only the asked kind counts, and prototype names are not kinds", () => {
    const s = withSessions({ concern: 3 }, { accommodation: 2 });
    expect(startLevelFor(s, "question")).toBe(1);
    expect(startLevelFor(s, "concern")).toBe(2);
    expect(startLevelFor(s, "constructor" as never)).toBe(1);
  });

  it("there is one HelpHistoryEntry type", () => {
    expect(readFileSync(new URL("../../src/features/memory/persona.ts", import.meta.url), "utf8")).not.toMatch(/interface HelpHistoryEntry/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("task calls: typedText and memory (I-035)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const PLAN_REPLY: PlanReplyT = { plan: DEMO_PLAN };
  const stateWith = (over: (s: RumiState) => void = () => undefined): RumiState => {
    const s = defaultState();
    over(s);
    return s;
  };
  const memoryOn = (s: RumiState): void => {
    s.settings.memoryOptIn = true;
    s.persona.recoveryCode = CODE;
    s.persona.facts = [
      { id: "support_pref:p2", kind: "support_pref", key: "p2", createdAt: "" },
      { id: "pacing:one_question", kind: "pacing", key: "one_question", createdAt: "" },
      { id: "help_level:question", kind: "help_level", key: "question", level: 2, createdAt: "" },
    ];
  };

  function make(reply: unknown = PLAN_REPLY) {
    const fetchFn = vi.fn<typeof fetch>(async () => Response.json(reply));
    vi.stubGlobal("fetch", fetchFn);
    const calls = { planCall, practiceCall, sayItCall, recapCall };
    const sent = () => {
      const [path, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      return { path, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    };
    return { fetchFn, calls, sent };
  }

  const planReq: PlanRequestT = { rawText: "My head hurts most afternoons.", companionName: "Rumi" };
  const practiceReq = (turns: PracticeRequestT["turns"], planText = "I want to ask about my headaches."): PracticeRequestT => ({
    plan: { ...DEMO_PLAN, items: [{ ...DEMO_PLAN.items[0], text: planText }] },
    turns,
    focus: "whole",
    companionName: "Rumi",
  });

  it("the test input really is a crisis, so the checks below mean something", () => {
    expect(isCrisis(CRISIS_TEXT)).toBe(true);
    expect(isCrisis("Do you have chest pain right now? I think I am having a heart attack.")).toBe(true);
  });

  it("plan: typed rawText with crisis wording stops before the network", async () => {
    const { fetchFn, calls } = make();
    expect(await calls.planCall(defaultState(), { ...planReq, rawText: CRISIS_TEXT })).toEqual({ ok: false, crisis: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("plan: a normal request goes to /api/plan with no key and no facts while memory is off", async () => {
    const { calls, sent } = make();
    const r = await calls.planCall(
      stateWith((s) => {
        memoryOn(s);
        s.settings.memoryOptIn = false;
      }),
      planReq,
    );
    expect(r).toEqual({ ok: true, data: PLAN_REPLY });
    expect(sent().path).toBe("/api/plan");
    expect(sent().headers["x-rumi-key"]).toBeUndefined();
    expect(sent().body).toEqual(planReq);
  });

  it("memory on: sends the code and only the stated facts as kind and key (no text, no help level)", async () => {
    const { calls, sent } = make();
    await calls.planCall(stateWith(memoryOn), planReq);
    expect(sent().headers["x-rumi-key"]).toBe(CODE);
    expect(sent().body.facts).toEqual([
      { kind: "support_pref", key: "p2" },
      { kind: "pacing", key: "one_question" },
    ]);
    expect(JSON.stringify(sent().body)).not.toMatch(/help_level|Please ask me/);
  });

  it("memory on but no stated facts: no facts field at all", async () => {
    const { calls, sent } = make();
    await calls.planCall(
      stateWith((s) => {
        memoryOn(s);
        s.persona.facts = s.persona.facts.filter((f) => f.kind === "help_level");
      }),
      planReq,
    );
    expect(sent().headers["x-rumi-key"]).toBe(CODE);
    expect("facts" in sent().body).toBe(false);
  });

  it("an invalid stored code is never sent", async () => {
    const { calls, sent } = make();
    await calls.planCall(
      stateWith((s) => {
        memoryOn(s);
        s.persona.recoveryCode = "abc";
      }),
      planReq,
    );
    expect(sent().headers["x-rumi-key"]).toBeUndefined();
    expect("facts" in sent().body).toBe(false);
  });

  it("practice: a symptom in the plan or a clinician line does not trigger the card; only the latest me turn counts", async () => {
    const { fetchFn, calls } = make({ clinicianSay: "Tell me more.", coveredItemIds: [], isLastTurn: false });
    const risky = "I think I am having a heart attack";
    const turns: PracticeRequestT["turns"] = [
      { role: "clinician", text: "Do you have chest pain right now?" },
      { role: "me", text: "My head hurts most afternoons." },
    ];
    expect((await calls.practiceCall(defaultState(), practiceReq(turns, risky))).ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const crisisNow = [...turns, { role: "clinician" as const, text: "Anything else?" }, { role: "me" as const, text: CRISIS_TEXT }];
    expect(await calls.practiceCall(defaultState(), practiceReq(crisisNow))).toEqual({ ok: false, crisis: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("practice: the first call has no typed text, and that is not 'check everything'", async () => {
    const { fetchFn, calls } = make({ clinicianSay: "What brings you in?", coveredItemIds: [], isLastTurn: false });
    const r = await calls.practiceCall(defaultState(), practiceReq([], "I think I am having a heart attack"));
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("sayit: a typed clinicianQuestion is checked, an AI-written one is not, and a scenario has nothing typed", async () => {
    const { fetchFn, calls } = make({ script: "I would like to book a visit.", blanks: [] });
    const typed: SayItRequestT = { level: 1, clinicianQuestion: CRISIS_TEXT, companionName: "Rumi" };
    expect(await calls.sayItCall(defaultState(), typed)).toEqual({ ok: false, crisis: true });
    expect(fetchFn).not.toHaveBeenCalled();
    expect((await calls.sayItCall(defaultState(), typed, { clinicianLineTyped: false })).ok).toBe(true);
    expect((await calls.sayItCall(defaultState(), { level: 2, scenario: "book", mainConcern: "chest pain last year and a heart attack scare", companionName: "Rumi" })).ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("recap: the fixed sample visit is sent without a client check and the reply is validated", async () => {
    const { fetchFn, calls, sent } = make(SAVED_RECAP_REPLY);
    const req: RecapRequestT = { lines: [...SAMPLE_VISIT], mySpeaker: "B", plan: DEMO_PLAN };
    const r = await calls.recapCall(defaultState(), req);
    expect(r).toMatchObject({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sent().path).toBe("/api/recap");
  });

  it("a reply of the wrong shape is ai_invalid, never data", async () => {
    const { calls } = make({ plan: { nope: true } });
    expect(await calls.planCall(defaultState(), planReq)).toMatchObject({ ok: false, error: { code: "ai_invalid" } });
  });

  describe("the default wiring (browser fetch, real crisis check, navigator.onLine)", () => {
    it("uses the global fetch and the real crisis check", async () => {
      const { fetchFn } = make();
      expect(await planCall(defaultState(), planReq)).toMatchObject({ ok: true });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn.mock.calls[0][0]).toBe("/api/plan");
      expect(await planCall(defaultState(), { ...planReq, rawText: CRISIS_TEXT })).toEqual({ ok: false, crisis: true });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("offline answers ai_unavailable without a request, for every task", async () => {
      const { fetchFn } = make();
      vi.stubGlobal("navigator", { onLine: false });
      const s = defaultState();
      const results = await Promise.all([
        planCall(s, planReq),
        practiceCall(s, practiceReq([])),
        sayItCall(s, { level: 1, scenario: "late", companionName: "Rumi" }),
        recapCall(s, { lines: [...SAMPLE_VISIT], mySpeaker: "B" }),
      ]);
      for (const r of results) expect(r).toMatchObject({ ok: false, error: { code: "ai_unavailable" } });
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("useMemoryControls controller, against the real routes over a fake Supermemory", () => {
  const ORIGIN = "https://rumi.test";

  function rig(opts: { enabled?: boolean; unreachable?: boolean } = {}) {
    const sm = fakeSupermemory();
    const clock = { t: 0 };
    const handlers = createMemoryHandlers({
      enabled: () => opts.enabled ?? true,
      config: () => ({ apiKey: "sm-key", tagSecret: SECRET }),
      fetchFn: sm.fetchFn,
      limiter: createRateLimiter({ limits: { perIp: 1000, perSession: 1000, perInstance: 1000, perUnknownIp: 1000 } }),
      forget: { now: () => clock.t, sleep: async (ms) => void (clock.t += ms) },
    });
    // The browser's fetch, answered by the route handlers in-process.
    const fetches = { n: 0 };
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      fetches.n++;
      if (opts.unreachable) throw new TypeError("network down");
      const path = String(input);
      const req = new Request(`${ORIGIN}${path}`, { ...init, headers: { ...(init?.headers as Record<string, string>), origin: ORIGIN } });
      return path === "/api/memory/facts" ? handlers.facts(req) : handlers.forget(req);
    }) as typeof fetch;
    const storage = fakeStorage();
    const store: StateStore = createStateStore({ storage });
    store.hydrate();
    store.update((d) => {
      d.supportCard = { id: "c", topQuestionIds: [], items: ["p1", "p2", "p5"].map((id) => ({ id, text: "x", source: "preset" as const, enabled: id !== "p5" })) };
    });
    const controller = createMemoryController(store, createMemoryActions({ store, fetchFn, timeoutMs: 5000 }));
    return { sm, store, controller, storage, fetches, now: (): MemoryControls => controller.getSnapshot() };
  }
  const remoteIds = (sm: ReturnType<typeof fakeSupermemory>): string[] => [...sm.store.values()].flatMap((m) => [...m.keys()]).sort();

  it("enable turns memory on, makes a code, saves the sentences and says saved", async () => {
    const { sm, controller, store } = rig();
    expect(controller.getSnapshot()).toMatchObject({ enabled: false, recoveryCode: undefined, busy: false, status: "idle", sentences: [] });
    expect(await controller.getSnapshot().enable()).toBe(true);
    const now = controller.getSnapshot();
    expect(now).toMatchObject({ enabled: true, busy: false, status: "saved" });
    expect(now.recoveryCode).toMatch(/^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
    expect(now.sentences).toEqual([factText("support_pref", "p1"), factText("support_pref", "p2")]);
    expect(remoteIds(sm)).toEqual(["pacing:one_question", "support_pref:p1", "support_pref:p2"]);
    expect(store.verifiedRecoveryCode()).toBe(now.recoveryCode);
  });

  it("busy is true while a call runs and false after; listeners are told both times", async () => {
    const { controller } = rig();
    const seen: boolean[] = [];
    const stop = controller.subscribe(() => seen.push(controller.getSnapshot().busy));
    await controller.getSnapshot().enable();
    stop();
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
    expect(controller.getSnapshot().busy).toBe(false);
  });

  it("the snapshot is the same object until something changes (useSyncExternalStore needs that)", async () => {
    const { controller } = rig();
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
    const before = controller.getSnapshot();
    await before.enable();
    expect(controller.getSnapshot()).not.toBe(before);
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
    expect(controller.getServerSnapshot()).toBe(controller.getServerSnapshot());
  });

  it("sync after the card changes updates the remote set", async () => {
    const { sm, controller, store } = rig();
    await controller.getSnapshot().enable();
    store.update((d) => void (d.supportCard = { id: "c", topQuestionIds: [], items: [{ id: "p3", text: "x", source: "preset", enabled: true }] }));
    expect(await controller.getSnapshot().sync()).toBe(true);
    expect(remoteIds(sm)).toEqual(["support_pref:p3"]);
  });

  it("disable stops saving but leaves what is saved", async () => {
    const { sm, controller } = rig();
    await controller.getSnapshot().enable();
    expect(await controller.getSnapshot().disable()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ enabled: false, status: "idle" });
    expect(remoteIds(sm)).toHaveLength(3);
  });

  it("forgetAll erases remotely (list, delete, list again), then clears code, facts and the switch", async () => {
    const { sm, controller } = rig();
    await controller.getSnapshot().enable();
    sm.calls.length = 0;
    expect(await controller.getSnapshot().forgetAll()).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ enabled: false, recoveryCode: undefined, facts: [], sentences: [], status: "idle" });
    expect(remoteIds(sm)).toEqual([]);
    const steps = sm.calls.map((c) => c.method);
    expect(steps.indexOf("DELETE")).toBeGreaterThan(0);
    expect(steps.slice(steps.indexOf("DELETE") + 1)).toContain("POST"); // listed again after deleting
  });

  it("an erase that cannot finish reports forget_failed and keeps the code, the facts and the switch", async () => {
    const { sm, controller } = rig();
    await controller.getSnapshot().enable();
    const code = controller.getSnapshot().recoveryCode;
    sm.stuckIds.add("support_pref:p1");
    expect(await controller.getSnapshot().forgetAll()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ enabled: true, recoveryCode: code, status: "forget_failed" });
    expect(controller.getSnapshot().facts.length).toBeGreaterThan(0);
    expect(await controller.getSnapshot().deleteEverything()).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ enabled: true, recoveryCode: code, status: "forget_failed" });
  });

  it("deleteEverything erases remotely, then resets this device", async () => {
    const { sm, controller, store, storage } = rig();
    await controller.getSnapshot().enable();
    expect(await controller.getSnapshot().deleteEverything()).toBe(true);
    expect(remoteIds(sm)).toEqual([]);
    expect(store.getSnapshot().state).toEqual(defaultState());
    expect(storage.data.size).toBe(0);
  });

  it("with the server routes off, enable says failed instead of pretending", async () => {
    const { controller } = rig({ enabled: false });
    expect(await controller.getSnapshot().enable()).toBe(false);
    expect(controller.getSnapshot().status).toBe("failed");
    expect(controller.getSnapshot().busy).toBe(false);
  });

  describe("wipeThisDevice (the way out when the server cannot be reached)", () => {
    it("flag off: deleteEverything stays honest and blocked, wipeThisDevice clears the device without any request", async () => {
      const { controller, store, storage, fetches, sm } = rig({ enabled: false });
      await controller.getSnapshot().enable(); // local switch and code exist, the server says forbidden
      expect(controller.getSnapshot().enabled).toBe(true);
      expect(await controller.getSnapshot().deleteEverything()).toBe(false);
      expect(controller.getSnapshot()).toMatchObject({ enabled: true, status: "forget_failed" });
      const before = fetches.n;
      expect(await controller.getSnapshot().wipeThisDevice()).toBe(true);
      expect(fetches.n).toBe(before); // no request at all
      expect(sm.calls).toHaveLength(0);
      expect(controller.getSnapshot()).toMatchObject({ enabled: false, recoveryCode: undefined, facts: [], sentences: [], status: "local_only_wiped", busy: false });
      expect(store.getSnapshot().state).toEqual(defaultState());
      expect(storage.data.size).toBe(0);
    });

    it("server unreachable: same way out, and nothing is sent", async () => {
      const { controller, fetches } = rig({ unreachable: true });
      await controller.getSnapshot().enable();
      expect(await controller.getSnapshot().deleteEverything()).toBe(false);
      expect(controller.getSnapshot().status).toBe("forget_failed");
      const before = fetches.n;
      expect(await controller.getSnapshot().wipeThisDevice()).toBe(true);
      expect(fetches.n).toBe(before);
      expect(controller.getSnapshot().status).toBe("local_only_wiped");
    });

    it("leaves a remote copy alone (it was not reached)", async () => {
      const { controller, sm } = rig();
      await controller.getSnapshot().enable();
      expect(remoteIds(sm)).toHaveLength(3);
      const calls = sm.calls.length;
      expect(await controller.getSnapshot().wipeThisDevice()).toBe(true);
      expect(sm.calls).toHaveLength(calls);
      expect(remoteIds(sm)).toHaveLength(3);
    });

    it("if the device cannot be cleared (storage blocked) it says so and keeps the data", async () => {
      const inner = fakeStorage();
      const blocked = {
        ...inner,
        removeItem: () => {
          throw new Error("blocked");
        },
      };
      const store = createStateStore({ storage: blocked });
      store.hydrate();
      store.update((d) => void (d.settings.companionName = "Mine"));
      const controller = createMemoryController(store, createMemoryActions({ store, fetchFn: (async () => Response.json({})) as typeof fetch }));
      expect(await controller.getSnapshot().wipeThisDevice()).toBe(false);
      expect(controller.getSnapshot().status).toBe("forget_failed");
      expect(store.getSnapshot().state.settings.companionName).toBe("Mine");
    });

    it("before the state is loaded it does nothing", async () => {
      const store = createStateStore({ storage: fakeStorage() });
      const controller = createMemoryController(store, createMemoryActions({ store, fetchFn: (async () => Response.json({})) as typeof fetch }));
      expect(await controller.getSnapshot().wipeThisDevice()).toBe(false);
    });
  });

  describe("after a failed erase, nothing is uploaded and the status stays", () => {
    async function failedErase() {
      const r = rig();
      await r.controller.getSnapshot().enable();
      r.sm.stuckIds.add("support_pref:p1");
      expect(await r.controller.getSnapshot().deleteEverything()).toBe(false);
      expect(r.controller.getSnapshot().status).toBe("forget_failed");
      return r;
    }

    it("sync() and enable() do nothing: no request, status unchanged, not busy", async () => {
      const { controller, fetches, sm } = await failedErase();
      const before = { fetches: fetches.n, calls: sm.calls.length };
      expect(await controller.getSnapshot().sync()).toBe(false);
      expect(await controller.getSnapshot().enable()).toBe(false);
      expect(fetches.n).toBe(before.fetches);
      expect(sm.calls).toHaveLength(before.calls);
      expect(controller.getSnapshot()).toMatchObject({ status: "forget_failed", busy: false, enabled: true });
    });

    it("retrying the erase and succeeding lifts the pause", async () => {
      const { controller, sm } = await failedErase();
      sm.stuckIds.clear();
      expect(await controller.getSnapshot().forgetAll()).toBe(true);
      expect(controller.getSnapshot().status).toBe("idle");
      expect(await controller.getSnapshot().enable()).toBe(true); // a fresh start works again
      expect(await controller.getSnapshot().sync()).toBe(true);
    });

    it("a retry that fails again keeps the pause", async () => {
      const { controller } = await failedErase();
      expect(await controller.getSnapshot().forgetAll()).toBe(false);
      expect(await controller.getSnapshot().sync()).toBe(false);
      expect(controller.getSnapshot().status).toBe("forget_failed");
    });

    it("turning memory off lifts the pause and shows idle", async () => {
      const { controller, fetches } = await failedErase();
      expect(await controller.getSnapshot().disable()).toBe(true);
      expect(controller.getSnapshot().status).toBe("idle");
      const before = fetches.n;
      expect(await controller.getSnapshot().sync()).toBe(true); // memory is off, so nothing is sent
      expect(fetches.n).toBe(before);
      expect(controller.getSnapshot().status).toBe("saved");
    });

    it("wiping the device lifts the pause", async () => {
      const { controller } = await failedErase();
      expect(await controller.getSnapshot().wipeThisDevice()).toBe(true);
      expect(await controller.getSnapshot().sync()).toBe(true);
    });
  });

  it("busy stays true until every overlapping call has finished", async () => {
    const store = createStateStore({ storage: fakeStorage() });
    store.hydrate();
    const gates: (() => void)[] = [];
    const later = <T,>(value: T) => new Promise<T>((resolve) => gates.push(() => resolve(value)));
    const actions = {
      enableMemory: () => later({ ok: true, remote: "ok" as const }),
      syncPersona: () => later({ saved: 0, remote: "ok" as const }),
    } as unknown as ReturnType<typeof createMemoryActions>;
    const c = createMemoryController(store, actions);
    const first = c.getSnapshot().enable();
    const second = c.getSnapshot().sync();
    expect(c.getSnapshot().busy).toBe(true);
    gates[0]();
    await first;
    expect(c.getSnapshot().busy).toBe(true); // the second call is still running
    gates[1]();
    await second;
    expect(c.getSnapshot().busy).toBe(false);
  });

  it("an action that throws cannot leave busy stuck", async () => {
    const store = createStateStore({ storage: fakeStorage() });
    store.hydrate();
    const boom = {
      enableMemory: async () => {
        throw new Error("x");
      },
    } as unknown as ReturnType<typeof createMemoryActions>;
    const c = createMemoryController(store, boom);
    expect(await c.getSnapshot().enable()).toBe(false);
    expect(c.getSnapshot()).toMatchObject({ busy: false, status: "failed" });
  });

  it("the hook is wired to the provider (server render shows the default, memory off)", () => {
    function Probe() {
      const m = useMemoryControls();
      return createElement("p", null, `${m.enabled}|${m.busy}|${m.status}|${m.sentences.length}|${typeof m.forgetAll}`);
    }
    expect(renderToString(createElement(RumiProvider, null, createElement(Probe)))).toContain("false|false|idle|0|function");
    expect(() => renderToString(createElement(Probe))).toThrow("useRumi outside RumiProvider");
  });
});
