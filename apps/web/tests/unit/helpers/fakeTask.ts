/**
 * Test doubles for the harness: a fake task spec, a scripted provider and a request builder.
 * The fake spec writes the name of every step it runs into `log`, so tests can pin the order of the pipeline.
 * Model answers can ask the fake spec for guard codes with the text `CODE:advice_dose` and for a crash with `THROWFINAL`.
 */
import { z } from "zod";
import { COMPANION_RE } from "@/features/shared/constants";
import type { GuardCode } from "@/features/shared/guards";
import type { TaskName, TaskSpec } from "@/features/shared/task";
import { buildLedger } from "@/lib/ai/ledger";
import { crisisTier } from "@/lib/crisis";
import { ProviderError, type Provider, type ProviderCall, type ProviderResult } from "@/lib/ai/provider";

export interface FakeReq {
  text: string;
  other?: string;
  companionName: string;
}
export interface FakeOut {
  say: string;
  crisis: boolean;
}
export interface FakeReply {
  say: string;
  degraded?: boolean;
}
export type FakeSpec = TaskSpec<FakeReq, FakeOut, FakeReply>;

export interface FakeTask {
  spec: FakeSpec;
  /** Step names in the order the harness ran them. The request schema logs once per parse, so it appears twice. */
  log: string[];
}

export function fakeTask(over: Partial<FakeSpec> & { name?: TaskName } = {}): FakeTask {
  const log: string[] = [];
  const step = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R => {
    log.push(name);
    return fn(...a);
  };
  const request = z
    .object({ text: z.string().trim().min(1).max(2000), other: z.string().max(300).optional(), companionName: z.string().regex(COMPANION_RE) })
    .transform((v) => {
      log.push("request");
      return v;
    });
  const spec: FakeSpec = {
    name: "plan",
    promptVersion: "plan@1",
    tier: "quality",
    request,
    modelOut: z.object({ say: z.string().min(1).max(300), crisis: z.boolean() }),
    reply: z.object({ say: z.string(), degraded: z.boolean().optional() }),
    crisisFields: step("crisisFields", (r: FakeReq) => ({ text: r.text })),
    buildLedger: step("buildLedger", (r: FakeReq) => buildLedger({ rawText: r.text })),
    build: step("build", (ctx) => ({
      system: "PERSONA TEXT",
      user: `TASK TEXT. ${ctx.fence("text", ctx.r.text)}${ctx.r.other === undefined ? "" : ` ${ctx.fence("other", ctx.r.other)}`}`,
    })),
    validate: step("validate", (_r: FakeReq, o: FakeOut): GuardCode[] => [...o.say.matchAll(/CODE:([a-z0-9_]+)/g)].map((m) => m[1] as GuardCode)),
    finalize: step("finalize", (_r: FakeReq, o: FakeOut): FakeReply => {
      if (o.say.includes("THROWFINAL")) throw new Error("finalize crashed");
      return { say: o.say };
    }),
    fallback: step("fallback", (r: FakeReq): FakeReply => ({ say: `fallback for ${r.text.length} characters` })),
    adviceGuard: true,
    useMemory: true,
    temperature: 0.3,
    maxOutputTokens: 700,
    mock: step("mock", (): FakeReply => ({ say: "mock reply" })),
    ...over,
  };
  return { spec, log };
}

export type Scripted = string | Error | ((call: ProviderCall) => ProviderResult | Promise<ProviderResult>);

export interface FakeProvider extends Provider {
  calls: ProviderCall[];
}

/** One scripted answer per call, in order. A string is the model text. An exhausted script is an 'http' failure. */
export function fakeProvider(script: Scripted[]): FakeProvider {
  const calls: ProviderCall[] = [];
  return {
    calls,
    async complete(call: ProviderCall): Promise<ProviderResult> {
      calls.push(call);
      const next = script[calls.length - 1];
      if (next === undefined) throw new ProviderError("http");
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next(call);
      return { text: next, modelUsed: call.tier === "quality" ? "model-quality-x" : "model-fast-y", inTokens: 100, outTokens: 20 };
    },
  };
}

export const say = (text: string, crisis = false): string => JSON.stringify({ say: text, crisis });
export const providerError = (kind: ConstructorParameters<typeof ProviderError>[0]): ProviderError => new ProviderError(kind);

let ipCounter = 0;
/** A same-origin browser-like POST. Every request gets its own address unless the test sets one. */
export function post(body: unknown, headers: Record<string, string> = {}, rawBody?: string): Request {
  ipCounter += 1;
  return new Request("https://rumi.test/api/fake", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", "x-real-ip": `198.51.100.${(ipCounter % 250) + 1}`, ...headers },
    body: rawBody ?? JSON.stringify(body),
  });
}

/** Under 12 characters on purpose: longer text is also sent to the crisis classifier (tier none), which pipeline tests are not about. */
export const okBody = (text = "Headaches.", extra: Record<string, unknown> = {}): Record<string, unknown> => ({ text, companionName: "Rumi", ...extra });

export async function bodyOf(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

const quiet = new WeakMap<Provider, Provider>();
/**
 * For pipeline tests that use text of 12 characters or more but are not about crisis: the harness also asks the classifier about
 * ordinary text (tier none). This wrapper answers that one question with "no", off the record (not in `calls`, no tokens), and
 * passes every other call through, including the question about tier check text, which a test scripts itself.
 * The same wrapper comes back for the same provider, so the circuit breaker still belongs to one provider.
 */
export function quietClassifier(provider: Provider): Provider {
  let wrapped = quiet.get(provider);
  if (wrapped === undefined) {
    wrapped = {
      async complete(call: ProviderCall): Promise<ProviderResult> {
        const text = /field=text>>>([\s\S]*?)<<<END/.exec(call.user)?.[1];
        if (call.system.includes("safety classifier") && text !== undefined && crisisTier(text) === "none") {
          return { text: '{"crisis":false}', modelUsed: "classifier", inTokens: 0, outTokens: 0 };
        }
        return provider.complete(call);
      },
    };
    quiet.set(provider, wrapped);
  }
  return wrapped;
}
