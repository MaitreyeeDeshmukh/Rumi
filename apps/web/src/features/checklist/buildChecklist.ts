/**
 * What to bring. Pure. The list is built in this order of trust:
 *  1. items the person's own letter lists (source "letter"). If the letter lists any, nothing else is added.
 *  2. items from the hospital's own pages (source "hospital", each with a link the person can open and check).
 *  3. a short common list for the kind of care (source "suggested").
 * Items the person wrote or changed (source "mine") are always kept, and a tick (done) is never lost.
 * Calling it again with the same input gives the same list, so it is safe to run whenever the appointment opens.
 */
import { GENERIC_BRING } from "@/content/checklist";
import { MAX_CHECKLIST } from "@/lib/storage-schema";
import type { Appointment, ChecklistItem, ChecklistSource } from "@/features/shared/types";

export { GENERIC_BRING };

export interface HospitalItem {
  text: string;
  url?: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A short id that depends only on the text, so the same item gets the same id every time. */
function idFor(source: ChecklistSource, text: string): string {
  let h = 5381;
  for (const ch of norm(text)) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return `${source[0]}-${h.toString(36)}`;
}

const make = (source: ChecklistSource, text: string, url?: string): ChecklistItem => {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 200);
  return { id: idFor(source, t), text: t, source, done: false, ...(url ? { url } : {}) };
};

/** Items from the letter's own "bring" and what the person wrote in the older plain list. */
function fromAppointment(a: Appointment): ChecklistItem[] {
  return (a.bring ?? []).filter((t) => t.trim() !== "").map((t) => make("mine", t));
}

export function buildChecklist(a: Appointment, hospital: readonly HospitalItem[] = []): ChecklistItem[] {
  const have = a.checklist ?? [];
  const byText = new Map<string, ChecklistItem>();
  const add = (item: ChecklistItem): void => {
    const key = norm(item.text);
    if (key === "") return;
    const old = byText.get(key);
    // The same words from two places are one item. The more trusted source and a tick win.
    if (old === undefined) byText.set(key, item);
    else byText.set(key, { ...old, done: old.done || item.done, ...(old.url === undefined && item.url !== undefined ? { url: item.url } : {}) });
  };

  for (const i of have) add(i);
  // The older plain list is taken in once, the first time the checklist is built.
  if (a.checklist === undefined) for (const i of fromAppointment(a)) add(i);
  const letterHas = [...byText.values()].some((i) => i.source === "letter");
  if (!letterHas) {
    for (const h of hospital) add(make("hospital", h.text, h.url));
  }
  const all = [...byText.values()];
  const hospitalHas = all.some((i) => i.source === "hospital");
  // Common items only fill the gap on the first build: a letter or a hospital page is better than a guess,
  // and an item the person removed must not come back the next time the appointment opens.
  if (a.checklist === undefined && !letterHas && !hospitalHas) for (const t of GENERIC_BRING[a.care]) add(make("suggested", t));

  const rank: Record<ChecklistSource, number> = { letter: 0, hospital: 1, suggested: 2, mine: 3 };
  return [...byText.values()]
    .filter((i) => !(i.source === "suggested" && (letterHas || hospitalHas)))
    .sort((x, y) => rank[x.source] - rank[y.source])
    .slice(0, MAX_CHECKLIST);
}

/** The text a person copies or prints: one line per item, with a mark for what is packed. */
export function checklistText(items: readonly ChecklistItem[]): string {
  return items.map((i) => `- ${i.text}${i.done ? " (packed)" : ""}`).join("\n");
}
