// The recap of the sample visit: the real /api/recap through callApi.
import { RecapReply } from "@/features/shared/schemas";
import type { Recap, RecapItem, RecapSection, Speaker, TranscriptLine } from "@/features/shared/types";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { SAVED_RECAP_REPLY } from "@/fixtures/sampleRecap";
import { SAMPLE_VISIT } from "@/fixtures/sampleVisit";
import { callApi } from "@/lib/api/callApi";

type Reply = typeof RecapReply._output;

export type RecapOutcome = { kind: "ok"; reply: Reply } | { kind: "crisis" } | { kind: "error" };

declare global {
  interface Window {
    /** E2E builds only: how many next recap calls fail. The real client is mocked at network level instead. */
    __rumiFailRecap?: number;
  }
}

/** The recap call. E2E builds can force failures. */
export async function requestRecap(mySpeaker: Speaker): Promise<RecapOutcome> {
  if (process.env.NEXT_PUBLIC_E2E === "1" && (window.__rumiFailRecap ?? 0) > 0) {
    window.__rumiFailRecap = (window.__rumiFailRecap ?? 0) - 1;
    return { kind: "error" };
  }
  // The visit is a fixed sample, so there is no typed text to check. The server still runs its own check.
  const res = await callApi("/api/recap", { lines: SAMPLE_VISIT, mySpeaker, plan: DEMO_PLAN }, RecapReply, { skipCrisisCheck: true });
  if (res.ok) return { kind: "ok", reply: res.data };
  return "crisis" in res ? { kind: "crisis" } : { kind: "error" };
}

/**
 * The recap of a visit the person recorded or typed. The client crisis check stays on, because this text came from the
 * person. No plan is sent: the plan statuses in the sample screen refer to the sample plan only. "B" is the person's voice,
 * but the lines carry only the clinician side (A), as the recording has one voice.
 */
export async function requestRecapLines(lines: TranscriptLine[]): Promise<RecapOutcome> {
  const res = await callApi("/api/recap", { lines, mySpeaker: "B" }, RecapReply);
  if (res.ok) return { kind: "ok", reply: res.data };
  return "crisis" in res ? { kind: "crisis" } : { kind: "error" };
}

/** A recap of the person's own visit, shown on screen only. It is not saved: the saved recap record is for the sample. */
export function buildOwnRecap(reply: Reply, lines: TranscriptLine[]): Recap {
  return {
    id: "visit-recap",
    createdAt: new Date().toISOString(),
    isSample: true, // ponytail: the type says true; nothing reads it for a recap that is not stored
    isSavedFallback: false,
    mySpeaker: "B",
    transcript: lines,
    items: reply.items,
    unconfirmed: reply.unconfirmed,
    planStatus: reply.planStatus,
  };
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
