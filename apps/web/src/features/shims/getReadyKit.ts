// swap when the lane merges (src/features/support/{presets,card}.ts, src/features/share/buildShareText.ts,
// src/features/plan call). Same signatures as plan 03 step 3. No sentences here: they come from src/content/getReady.ts.
import { z } from "zod";
import { CARD_TEXT, KIT_TEXT, SUPPORT_PRESETS } from "@/content/getReady";
import { callApi } from "@/features/shims/callApi";
import { literalLint } from "@/lib/literalLint";
import type { ApiResult, Persona, RumiState, Settings, SupportCard, SupportItem, VisitPlan } from "@/features/shims/types";

export const MAX_CUSTOM_WORDS = 15;
export const MAX_QUESTIONS = 2;

const PlanItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(["concern", "question", "accommodation"]),
  source: z.enum(["user", "suggested"]),
  enabled: z.boolean(),
});
export const PlanReply = z.object({
  plan: z.object({
    id: z.string(),
    title: z.string(),
    createdAt: z.string(),
    mainConcern: z.string(),
    symptomsInMyWords: z.array(z.string()),
    items: z.array(PlanItemSchema),
  }),
  thin: z.boolean().optional(),
  degraded: z.boolean().optional(),
});
export type PlanReply = z.infer<typeof PlanReply>;

/**
 * Asks for a plan. The network answers first, so a test (or the real route later) can send a plan, an error, a
 * `{ crisis: true }` body or a degraded reply. With no route (404) or no network it falls back to the callApi shim fixture.
 */
export async function planCall(rawText: string, companionName: string): Promise<ApiResult<PlanReply>> {
  const body = { rawText, companionName };
  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 404) {
      const json: unknown = await res.json().catch(() => null);
      if (json && typeof json === "object" && "crisis" in json) return { ok: false, crisis: true };
      const parsed = PlanReply.safeParse(json);
      if (res.ok && parsed.success) return { ok: true, data: parsed.data };
      const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
      return { ok: false, error: { code: "ai_unavailable", message: typeof message === "string" ? message : "" } };
    }
  } catch {
    // no network: use the fixture below
  }
  return callApi("/api/plan", body, PlanReply);
}

/** One item per preset; on only if the persona holds `support_pref:<id>`. The first two enabled question lines are the top questions. */
export function newSupportCard(plan: VisitPlan | undefined, persona: Persona): SupportCard {
  const on = new Set(persona.facts.filter((f) => f.kind === "support_pref").map((f) => f.key));
  return {
    id: "card-" + (plan?.id ?? "new"),
    items: SUPPORT_PRESETS.map((p) => ({ id: p.id, text: p.text, source: "preset", enabled: on.has(p.id) })),
    topQuestionIds: (plan?.items ?? []).filter((i) => i.enabled && i.kind === "question").slice(0, MAX_QUESTIONS).map((i) => i.id),
  };
}

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Adds one of the person's own sentences. The error text comes from the content file. */
export function addCustomItem(card: SupportCard, text: string): { card: SupportCard; error?: string } {
  const t = text.trim();
  if (!t) return { card, error: CARD_TEXT.customEmpty };
  if (wordCount(t) > MAX_CUSTOM_WORDS || !literalLint(t).ok) return { card, error: CARD_TEXT.customLong };
  const n = card.items.filter((i) => i.source === "user").length + 1;
  const item: SupportItem = { id: "u" + n, text: t, source: "user", enabled: true };
  return { card: { ...card, items: [...card.items, item] } };
}

/** Plain text, no markdown, so Copy and Print match the screen. '' when nothing is switched on. */
export function buildSupportCardText(card: SupportCard, plan: VisitPlan | undefined): string {
  const blocks: string[] = [];
  const lines = card.items.filter((i) => i.enabled).map((i) => `- ${i.text}`);
  if (lines.length) blocks.push([CARD_TEXT.supported, ...lines].join("\n"));
  if (plan?.mainConcern.trim()) blocks.push(`${CARD_TEXT.concern}\n${plan.mainConcern.trim()}`);
  const asked = card.topQuestionIds
    .slice(0, MAX_QUESTIONS)
    .map((id) => plan?.items.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => !!i && i.enabled);
  if (asked.length) blocks.push([CARD_TEXT.questions, ...asked.map((q, n) => `${n + 1}. ${q.text}`)].join("\n"));
  return blocks.join("\n\n");
}

/** The plan lines that are on, then the support card. '' when there is no plan or card. */
export function buildKitText(state: RumiState): string {
  const { plan, supportCard } = state;
  if (!plan || !supportCard) return "";
  const on = plan.items.filter((i) => i.enabled).map((i) => `- ${i.text}`);
  const planBlock = on.length ? [KIT_TEXT.planTitle, ...on].join("\n") : "";
  return [planBlock, buildSupportCardText(supportCard, plan)].filter(Boolean).join("\n\n");
}

export const shouldPlayFinishSound = (s: Settings): boolean => s.finishSound === true;
