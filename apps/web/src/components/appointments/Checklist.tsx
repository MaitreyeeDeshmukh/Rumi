"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { fieldControlClass } from "@/components/ui/field";
import { CHECK } from "@/content/appointmentScan";
import { newId, whereLine } from "@/features/appointments/appointments";
import { buildChecklist } from "@/features/checklist/buildChecklist";
import type { Appointment, ChecklistItem } from "@/features/shared/types";
import { appointmentLookupCall } from "@/lib/api/calls";
import { fill } from "@/lib/fill";
import { useRumi } from "@/lib/rumiActive";
import { MAX_CHECKLIST } from "@/lib/storage-schema";

/** What to bring: tick off, see where each item came from, edit, add, and look up the hospital's own list. */
export function Checklist({ a, change }: { a: Appointment; change: (fn: (x: Appointment) => void) => void }) {
  const { state } = useRumi();
  const addId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const items = a.checklist ?? [];

  // The first time an appointment opens, the list is built and saved: the letter's items, or the common list for this care.
  useEffect(() => {
    if (a.checklist === undefined) change((x) => (x.checklist = buildChecklist(x)));
  }, [a.checklist, change]);

  const set = (id: string, fn: (i: ChecklistItem) => void) => change((x) => fn((x.checklist ?? []).find((i) => i.id === id) ?? ({} as ChecklistItem)));
  const add = () => {
    const text = draft.trim().slice(0, 200);
    if (!text || items.length >= MAX_CHECKLIST) return;
    change((x) => (x.checklist = [...(x.checklist ?? []), { id: newId("c"), text, source: "mine", done: false }]));
    setDraft("");
  };
  const hasLetter = items.some((i) => i.source === "letter");

  const lookup = async () => {
    const place = whereLine(a).slice(0, 160);
    if (place.length < 2) return setMsg(CHECK.needPlace);
    setBusy(true);
    setMsg(CHECK.looking);
    const res = await appointmentLookupCall(state, { place, care: a.care });
    setBusy(false);
    if (!res.ok || "crisis" in res) return setMsg(CHECK.lookFailed);
    if (!res.data.found) return setMsg(CHECK.lookNone);
    change((x) => (x.checklist = buildChecklist(x, res.data.items)));
    setMsg(CHECK.lookDone);
  };

  const done = items.filter((i) => i.done).length;
  return (
    <section id="bring" aria-labelledby="appt-bring" className="grid gap-3">
      <div>
        <h2 id="appt-bring" className="mt-0 mb-1 text-xl">
          {CHECK.heading}
        </h2>
        <p className="m-0 text-muted-ink">{CHECK.lead}</p>
      </div>
      {items.length === 0 ? <p className="m-0 text-muted-ink">{CHECK.empty}</p> : <p className="m-0 font-bold">{fill(CHECK.progress, { done, total: items.length })}</p>}
      <ul className="m-0 grid list-none divide-y divide-line border-y border-line p-0">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
            <Checkbox id={`bring-${i.id}`} checked={i.done} onCheckedChange={(v) => set(i.id, (it) => (it.done = v === true))} aria-label={fill(CHECK.itemLabel, { item: i.text })} />
            {editing ? (
              <input
                aria-label={fill(CHECK.itemLabel, { item: i.text })}
                maxLength={200}
                className={`${fieldControlClass} min-w-0 flex-1`}
                value={i.text}
                onChange={(e) => set(i.id, (it) => (it.text = e.target.value))}
              />
            ) : (
              <label htmlFor={`bring-${i.id}`} className="min-w-0 flex-1 cursor-pointer font-bold">
                {i.text}
              </label>
            )}
            <span className="text-sm text-muted-ink">{CHECK.sources[i.source]}</span>
            {i.url ? (
              <a href={i.url} target="_blank" rel="noopener noreferrer" aria-label={fill(CHECK.linkFor, { item: i.text })} className="text-sm underline">
                {CHECK.link}
              </a>
            ) : null}
            {editing ? (
              <Button kind="tertiary" onClick={() => change((x) => (x.checklist = (x.checklist ?? []).filter((y) => y.id !== i.id)))}>
                {fill(CHECK.remove, { item: i.text })}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="flex items-end gap-2">
          <div className="grid min-w-0 flex-1 gap-1">
            <label htmlFor={addId} className="text-sm font-bold">
              {CHECK.addLabel}
            </label>
            <input
              id={addId}
              maxLength={200}
              className={fieldControlClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </div>
          <Button kind="secondary" onClick={add}>
            {CHECK.add}
          </Button>
        </div>
      ) : null}
      <p className="note m-0">{CHECK.note}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button kind="secondary" onClick={() => setEditing((v) => !v)}>
          {editing ? CHECK.doneEditing : CHECK.edit}
        </Button>
        {hasLetter ? null : (
          <Button kind="tertiary" disabled={busy} onClick={() => void lookup()}>
            {CHECK.lookup}
          </Button>
        )}
      </div>
      {hasLetter ? null : <p className="note m-0">{CHECK.lookupNote}</p>}
      <p role="status" className="m-0 min-h-6 text-muted-ink">
        {msg}
      </p>
    </section>
  );
}
