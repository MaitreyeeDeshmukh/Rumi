/**
 * End to end through the real harness: one Request per route, in MOCK_AI mode (the route handlers themselves) and
 * with a scripted provider (the real path, runTask with each spec). Covers the Phase 2 gate for the four task routes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as planPost } from "@/app/api/plan/route";
import { POST as practicePost } from "@/app/api/practice/route";
import { POST as recapPost } from "@/app/api/recap/route";
import { POST as sayitPost } from "@/app/api/sayit/route";
import { planSpec } from "@/features/plan/spec";
import { practiceSpec } from "@/features/practice/spec";
import { recapSpec } from "@/features/recap/spec";
import { sayitSpec } from "@/features/sayit/spec";
import type { TaskSpec } from "@/features/shared/task";
import { presetText } from "@/features/support/presets";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { SAMPLE_VISIT } from "@/fixtures/sampleVisit";
import { SAVED_RECAP_REPLY } from "@/fixtures/sampleRecap";
import { runTask } from "@/lib/ai/harness";
import { setLogSink } from "@/lib/ai/telemetry";
import { createRateLimiter } from "@/lib/security/rateLimit";
import { bodyOf, fakeProvider, post, providerError, type Scripted } from "./helpers/fakeTask";
import { outsideFences } from "./helpers/specCtx";

const HEX = "0123456789ab";
const logs: string[] = [];
beforeEach(() => {
  logs.length = 0;
  setLogSink((l) => logs.push(l));
});
afterEach(() => {
  setLogSink(null);
  vi.unstubAllEnvs();
});

type AnySpec = TaskSpec<never, unknown, unknown>;
interface Case {
  name: "plan" | "practice" | "sayit" | "recap";
  spec: AnySpec;
  route: (req: Request) => Promise<Response>;
  body: Record<string, unknown>;
  /** A model answer that passes every check. */
  good: unknown;
  /** Words of the request that must appear only inside fences. */
  secrets: string[];
}

const labelledSaved = {
  items: SAVED_RECAP_REPLY.items.map((i) => ({ ...i, evidence: i.evidence.map((e) => e.toUpperCase()) })),
  planStatus: SAVED_RECAP_REPLY.planStatus.map((p) => ({ ...p, evidence: p.evidence.map((e) => e.toUpperCase()) })),
};

const CASES: Case[] = [
  {
    name: "plan",
    spec: planSpec as unknown as AnySpec,
    route: planPost,
    body: { rawText: "I keep getting headaches. My mom always talks for me. I forget things.", companionName: "Rumi" },
    good: {
      mainConcern: "I keep getting headaches",
      symptomsInMyWords: ["headaches", "forget things"],
      items: [
        { text: "I want to tell you about my headaches.", kind: "concern", source: "user" },
        { text: "I want to ask what I should do next.", kind: "question", source: "suggested" },
      ],
      crisis: false,
    },
    secrets: ["headaches", "mom always"],
  },
  {
    name: "practice",
    spec: practiceSpec as unknown as AnySpec,
    route: practicePost,
    body: { plan: DEMO_PLAN, focus: "problem", companionName: "Rumi", turns: [{ role: "clinician", text: "Hi. What brings you in today?" }, { role: "me", text: "Zebra pains since the picnic." }] },
    good: { clinicianSay: "How often does it happen?", coveredItemIds: [], isLastTurn: false, crisis: false },
    secrets: ["Zebra pains", "picnic"],
  },
  {
    name: "sayit",
    spec: sayitSpec as unknown as AnySpec,
    route: sayitPost,
    body: { level: 2, clinicianQuestion: "Quokka question about the weekend?", companionName: "Rumi", mainConcern: "I keep getting headaches", symptomsInMyWords: ["headaches"] },
    good: { script: "My headaches started [when they started].", blanks: [], crisis: false },
    secrets: ["Quokka question", "weekend"],
  },
  {
    name: "recap",
    spec: recapSpec as unknown as AnySpec,
    route: recapPost,
    body: { lines: SAMPLE_VISIT, mySpeaker: "B", plan: DEMO_PLAN },
    good: labelledSaved,
    secrets: ["blood pressure", "package directions"],
  },
];

const run = (c: Case, script: Scripted[], body: Record<string, unknown> = c.body) => {
  const provider = fakeProvider(script);
  return { provider, done: runTask(c.spec as never, post(body), { provider, limiter: createRateLimiter(), rand: () => HEX }) };
};
const json = async (res: Response): Promise<Record<string, unknown>> => (await bodyOf(res)) as Record<string, unknown>;
const ev = (): Record<string, unknown> => JSON.parse(logs.at(-1) as string) as Record<string, unknown>;

describe.each(CASES)("/api/$name in MOCK_AI mode, through the route handler", (c) => {
  it("answers 200 with a reply that satisfies the reply schema, degraded false, no model", async () => {
    vi.stubEnv("MOCK_AI", "1");
    const res = await c.route(post(c.body));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await json(res);
    expect(c.spec.reply.safeParse(body).success).toBe(true);
    expect(body.degraded).toBe(false);
    expect(ev()).toMatchObject({ task: c.name, outcome: "mock", degraded: false, attempts: 0 });
  });

  it("rejects a cross-site request and a body that breaks the schema", async () => {
    vi.stubEnv("MOCK_AI", "1");
    expect((await c.route(post(c.body, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await c.route(post({ ...c.body, ...(c.name === "recap" ? { mySpeaker: "Z" } : { companionName: "<script>" }) }))).status).toBe(400);
  });
});

describe.each(CASES)("/api/$name with a scripted provider (the real path)", (c) => {
  it("a valid model answer comes back as a reply, degraded false, using the spec's tier and settings", async () => {
    const { provider, done } = run(c, [JSON.stringify(c.good)]);
    const res = await done;
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(c.spec.reply.safeParse(body).success).toBe(true);
    expect(body.degraded).toBe(false);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ tier: c.spec.tier, temperature: c.spec.temperature, maxOutputTokens: c.spec.maxOutputTokens });
    expect(ev()).toMatchObject({ task: c.name, outcome: "ok", degraded: false, attempts: 1 });
  });

  it("the composed prompt has exactly one preamble, one persona and one of each region, and request text only inside fences", async () => {
    const { provider, done } = run(c, [JSON.stringify(c.good)]);
    await done;
    const { system, user } = provider.calls[0];
    expect(system.match(/LITERAL MODE \(always on\)/g)).toHaveLength(1);
    expect(system.match(/You are Rumi, a helper/g)).toHaveLength(1);
    expect(system.match(c.name === "practice" ? /You play Dr\. Lee/g : /How you write:/g)).toHaveLength(1);
    for (const region of ["STYLE", "FACTS", "TASK"]) {
      expect(user.match(new RegExp(`<<<${region} ${HEX}>>>`, "g")), region).toHaveLength(1);
      expect(user.match(new RegExp(`<<<END ${region} ${HEX}>>>`, "g")), region).toHaveLength(1);
    }
    expect(user.indexOf("<<<STYLE")).toBeLessThan(user.indexOf("<<<FACTS"));
    expect(user.indexOf("<<<FACTS")).toBeLessThan(user.indexOf("<<<TASK"));
    expect(user.trimEnd().endsWith(`<<<END TASK ${HEX}>>>`)).toBe(true);
    const bare = outsideFences(`${system}\n${user}`);
    for (const word of c.secrets) expect(bare, word).not.toContain(word);
    expect(user).toMatchSnapshot();
  });

  it("the provider being down gives the built-in reply with degraded:true, never an error", async () => {
    const { provider, done } = run(c, [providerError("http"), providerError("timeout")]);
    const res = await done;
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(c.spec.reply.safeParse(body).success).toBe(true);
    expect(body.degraded).toBe(true);
    expect(provider.calls.length).toBeLessThanOrEqual(3);
    expect(ev()).toMatchObject({ outcome: "fallback", degraded: true });
  });

  it("two answers that are not JSON give the built-in reply with degraded:true", async () => {
    const { done } = run(c, ["not json", "still not json"]);
    const body = await json(await done);
    expect(c.spec.reply.safeParse(body).success).toBe(true);
    expect(body.degraded).toBe(true);
  });

  it("one bad answer then a good one is a retry, not a fallback", async () => {
    const { provider, done } = run(c, ["not json", JSON.stringify(c.good)]);
    const body = await json(await done);
    expect(body.degraded).toBe(false);
    expect(provider.calls).toHaveLength(2);
  });

  it("the model flagging a crisis returns the crisis reply and nothing else", async () => {
    const { done } = run(c, [JSON.stringify({ crisis: true })]);
    expect(await json(await done)).toEqual({ crisis: true });
  });
});

describe("crisis text never reaches a model", () => {
  const SAY = "I want to kill myself";
  const typed: Record<string, Record<string, unknown>> = {
    plan: { rawText: `My head hurts. ${SAY}.`, companionName: "Rumi" },
    practice: { ...CASES[1].body, turns: [{ role: "clinician", text: "Hi." }, { role: "me", text: SAY }] },
    sayit: { ...CASES[2].body, clinicianQuestion: SAY },
  };
  it.each(Object.keys(typed))("%s: the typed text is checked and no provider is called", async (name) => {
    const c = CASES.find((x) => x.name === name) as Case;
    const { provider, done } = run(c, [JSON.stringify(c.good)], typed[name]);
    expect(await json(await done)).toEqual({ crisis: true });
    expect(provider.calls).toHaveLength(0);
    expect(ev()).toMatchObject({ outcome: "crisis", attempts: 0 });
  });

  it("an OLD turn with crisis words does not stop practice; only the latest me turn is checked", async () => {
    const c = CASES[1];
    const body = { ...c.body, turns: [{ role: "me", text: SAY }, { role: "clinician", text: "Are you safe?" }, { role: "me", text: "My head hurts." }] };
    const { provider, done } = run(c, [JSON.stringify(c.good)], body);
    expect((await json(await done)).crisis).toBeUndefined();
    expect(provider.calls).toHaveLength(1);
  });

  it("a clinician line like 'any chest pain?' does not trigger crisis in practice", async () => {
    const c = CASES[1];
    const body = { ...c.body, turns: [{ role: "clinician", text: "Any chest pain? Any trouble breathing?" }, { role: "me", text: "No, just headaches." }] };
    const { provider, done } = run(c, [JSON.stringify(c.good)], body);
    expect((await json(await done)).crisis).toBeUndefined();
    expect(provider.calls).toHaveLength(1);
  });
});

describe("what the harness enforces on practice answers", () => {
  const c = CASES[1];
  const say = (clinicianSay: string) => JSON.stringify({ clinicianSay, coveredItemIds: [], isLastTurn: false, crisis: false });

  it.each([
    ["a stated finding", "Your blood pressure looks normal today."],
    ["a number the user never gave", "Your pulse is 90."],
    ["a claim to be real", "I am a real doctor."],
    ["a diagnosis", "You probably have migraine."],
  ])("%s twice gives the fallback with degraded:true", async (_n, text) => {
    const { provider, done } = run(c, [say(text), say(text)]);
    const body = await json(await done);
    expect(body.degraded).toBe(true);
    expect(provider.calls).toHaveLength(2);
  });

  it("the escape hatches pass: a plain question, and the 1 to 10 scale", async () => {
    for (const text of ["Do you have any questions for me?", "On a scale of 1 to 10, how strong is it?"]) {
      const body = await json(await run(c, [say(text)]).done);
      expect(body, text).toMatchObject({ clinicianSay: text, degraded: false });
    }
  });

  it("the unknown label is a hard failure, and the retry can fix it", async () => {
    const bad = JSON.stringify({ clinicianSay: "When did it start?", coveredItemIds: ["q9"], isLastTurn: false, crisis: false });
    const body = await json(await run(c, [bad, say("When did it start?")]).done);
    expect(body.degraded).toBe(false);
  });
});

describe("what finalize does with a model answer, through the harness", () => {
  it("plan: positional ids, suggested items off, a real time stamp, thin from the ledger", async () => {
    const body = await json(await run(CASES[0], [JSON.stringify(CASES[0].good)]).done);
    const plan = body.plan as { id: string; createdAt: string; items: { id: string; enabled: boolean; source: string }[] };
    expect(plan.items.map((i) => [i.id, i.source, i.enabled])).toEqual([["q1", "user", true], ["q2", "suggested", false]]);
    expect(Math.abs(Date.parse(plan.createdAt) - Date.now())).toBeLessThan(60_000);
    expect(body.thin).toBe(false);
  });

  it("sayit: the blanks are derived from the script", async () => {
    const body = await json(await run(CASES[2], [JSON.stringify({ ...(CASES[2].good as object), blanks: ["made up"] })]).done);
    expect(body).toMatchObject({ script: "My headaches started [when they started].", blanks: ["when they started"] });
  });

  it("practice: covered items are confirmed against the user's latest turn", async () => {
    const c = CASES[1];
    const claim = JSON.stringify({ clinicianSay: "When did it start?", coveredItemIds: ["q1", "q4"], isLastTurn: false, crisis: false });
    const body = await json(await run(c, [claim], { ...c.body, turns: [{ role: "me", text: "I want to tell you about my headaches." }] }).done);
    expect(body.coveredItemIds).toEqual(["q1"]);
  });

  it("recap: the saved recap comes back unchanged with real line ids; an unbacked claim is demoted, not retried", async () => {
    const c = CASES[3];
    const same = await json(await run(c, [JSON.stringify(c.good)]).done);
    expect(same).toEqual({ ...SAVED_RECAP_REPLY, dropped: 0, degraded: false });

    const invented = { items: [{ section: "medications", text: "Naproxen: take if needed.", evidence: ["L12"] }], planStatus: [] };
    const { provider, done } = run(c, [JSON.stringify(invented)]);
    const body = await json(await done);
    expect(provider.calls).toHaveLength(1);
    expect(body).toMatchObject({ items: [], dropped: 1, degraded: false });
    // The demoted text is an order ("take ..."), so the generic line is shown instead of the model's words.
    expect(body.unconfirmed).toContain("I could not confirm this: one point from the visit text.");
    expect(JSON.stringify(body)).not.toContain("Naproxen");
  });

  it("recap: a dose the clinician said in the visit is not blocked by the advice guard", async () => {
    const c = CASES[3];
    const lines = [
      { id: "a1", speaker: "A", text: "Take ibuprofen 400 mg twice a day." },
      { id: "a2", speaker: "B", text: "Okay." },
    ];
    const out = { items: [{ section: "medications", text: "Ibuprofen: 400 mg twice a day.", evidence: ["L1"] }], planStatus: [] };
    const body = await json(await run(c, [JSON.stringify(out)], { lines, mySpeaker: "B" }).done);
    expect(body).toMatchObject({ degraded: false, dropped: 0 });
    expect((body.items as unknown[]).length).toBe(1);
  });

  it("recap: an answer citing a line that does not exist is a hard failure (unknown_label) and falls back after the retry", async () => {
    const c = CASES[3];
    const bad = JSON.stringify({ items: [{ section: "discussed", text: "Headaches.", evidence: ["L99"] }], planStatus: [] });
    const body = await json(await run(c, [bad, bad]).done);
    expect(body.degraded).toBe(true);
  });
});

describe("stated preferences", () => {
  it("facts in the body become fenced STYLE lines for plan, practice and say-it, and none for recap", async () => {
    const facts = [{ kind: "support_pref", key: "p1" }];
    for (const c of CASES) {
      const { provider, done } = run(c, [JSON.stringify(c.good)], { ...c.body, facts });
      await done;
      const { user } = provider.calls[0];
      const style = user.slice(0, user.indexOf(`<<<END STYLE ${HEX}>>>`));
      if (c.spec.useMemory) expect(style, c.name).toContain(`field=memory>>>${presetText("p1")}<<<END ${HEX}>>>`);
      else expect(style, c.name).toContain("(no stated preferences)");
    }
  });
});
