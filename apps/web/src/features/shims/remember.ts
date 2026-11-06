// swap when the lane merges: requestRecap becomes callApi('/api/recap', ...) from src/lib/api/client.ts.
import { z } from "zod";
import { callApi } from "@/features/shims/callApi";
import { DEMO_PLAN, SAMPLE_VISIT, SAVED_RECAP_REPLY } from "@/features/shims/fixtures";
import type { Recap, RecapItem, RecapSection, Speaker } from "@/features/shims/types";

const RecapReply = z.object({
  items: z.array(z.object({ section: z.enum(["discussed", "instructions", "medications", "next_steps"]), text: z.string(), evidence: z.array(z.string()) })),
  unconfirmed: z.array(z.string()),
  planStatus: z.array(z.object({ itemId: z.string(), status: z.enum(["asked_by_me", "asked_by_other", "not_asked", "unclear"]), evidence: z.array(z.string()) })),
  dropped: z.number(),
});
type Reply = z.infer<typeof RecapReply>;

export type RecapOutcome = { kind: "ok"; reply: Reply } | { kind: "crisis" } | { kind: "error" };

declare global {
  interface Window {
    /** E2E builds only: how many next recap calls fail. The real client is mocked at network level instead. */
    __rumiFailRecap?: number;
  }
}

/** The recap call. The shim answers from a fixture; E2E builds can force failures. */
export async function requestRecap(mySpeaker: Speaker): Promise<RecapOutcome> {
  if (process.env.NEXT_PUBLIC_E2E === "1" && (window.__rumiFailRecap ?? 0) > 0) {
    window.__rumiFailRecap = (window.__rumiFailRecap ?? 0) - 1;
    return { kind: "error" };
  }
  const res = await callApi("/api/recap", { lines: SAMPLE_VISIT, mySpeaker, plan: DEMO_PLAN }, RecapReply);
  if (res.ok) return { kind: "ok", reply: res.data };
  return "crisis" in res ? { kind: "crisis" } : { kind: "error" };
}

/** The saved example answer, used after two failed calls. */
export const SAVED_REPLY: Reply = SAVED_RECAP_REPLY;

/** The Recap record kept in state (sample only). */
export function buildRecap(reply: Reply, mySpeaker: Speaker, saved: boolean): Recap {
  return {
    id: "sample-recap",
    planId: DEMO_PLAN.id,
    createdAt: new Date().toISOString(),
    isSample: true,
    isSavedFallback: saved,
    mySpeaker,
    transcript: [...SAMPLE_VISIT],
    items: reply.items,
    unconfirmed: reply.unconfirmed,
    planStatus: reply.planStatus,
  };
}

const SECTION_ORDER: RecapSection[] = ["discussed", "instructions", "medications", "next_steps"];

/** Sections that have items, in reading order. */
export function groupItems(items: RecapItem[]): { section: RecapSection; items: { index: number; item: RecapItem }[] }[] {
  return SECTION_ORDER.map((section) => ({
    section,
    items: items.flatMap((item, index) => (item.section === section ? [{ index, item }] : [])),
  })).filter((g) => g.items.length > 0);
}

/** Voices in the visit, each with its first line, in order of first appearance. */
export function voicesOf(lines: readonly { speaker: Speaker; text: string }[]): { speaker: Speaker; first: string }[] {
  const seen = new Map<Speaker, string>();
  for (const l of lines) if (!seen.has(l.speaker)) seen.set(l.speaker, l.text);
  return [...seen].map(([speaker, first]) => ({ speaker, first })).sort((a, b) => a.speaker.localeCompare(b.speaker));
}

/** Drops the "I could not confirm this:" lead the reply may carry, because the section title says it. */
export const unconfirmedText = (s: string): string => s.replace(/^I could not confirm this:\s*/i, "");

/** A line shown as a quote, with curly quotes. */
export const quoted = (s: string): string => `\u201c${s}\u201d`;
