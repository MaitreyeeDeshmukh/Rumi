"use client";

import { useId, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { fieldControlClass } from "@/components/ui/field";
import { Plus, X } from "@/components/ui/icons";
import { APPT } from "@/content/appointments";
import { dayLong, icsFor, timeText } from "@/features/appointments/appointments";
import type { Appointment } from "@/features/shared/types";

/** One appointment in the list. */
export function ApptCard({ a }: { a: Appointment }) {
  return (
    <li className="grid gap-1 rounded-card border border-line bg-surface p-4">
      <p className="m-0 font-bold">
        {APPT.care[a.care]}: {a.providerName}
      </p>
      <p className="m-0">
        {dayLong(a.date)} at {timeText(a.time)}
      </p>
      <p className="m-0 text-muted-ink">
        {a.clinic || a.address}
        {a.reason ? `. ${a.reason}` : ""}
      </p>
      <p className="m-0 text-sm font-bold">{a.status === "confirmed" ? APPT.confirmed : APPT.toConfirm}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ButtonLink kind="secondary" href={`/appointment?id=${a.id}`}>
          {APPT.details}
        </ButtonLink>
        <ButtonLink kind="tertiary" href={`/appointment?id=${a.id}#prep`}>
          {APPT.prep}
        </ButtonLink>
      </div>
    </li>
  );
}

/** The call script: editable text, a copy button. */
export function CallScriptBox({ initial }: { initial: string }) {
  const id = useId();
  const [text, setText] = useState(initial);
  const [msg, setMsg] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(APPT.copied);
    } catch {
      setMsg(APPT.copyFailed);
    }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-2">
      <h2 id={`${id}-h`} className="m-0 text-xl">
        {APPT.scriptHeading}
      </h2>
      <p className="m-0 text-muted-ink">{APPT.scriptLead}</p>
      <textarea aria-label={APPT.scriptLabel} rows={7} className={fieldControlClass} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center gap-3">
        <Button kind="secondary" onClick={() => void copy()}>
          {APPT.copyScript}
        </Button>
        <p role="status" className="note m-0">
          {msg}
        </p>
      </div>
    </section>
  );
}

/** Downloads a calendar file made in the browser. Nothing is uploaded. */
export function downloadIcs(a: Appointment): void {
  const url = URL.createObjectURL(new Blob([icsFor(a, new Date())], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "appointment.ics";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A short list the person adds to and removes from. Saves through onChange. */
export function ListEditor({ title, addLabel, items, onChange }: { title: string; addLabel: string; items: readonly string[]; onChange: (next: string[]) => void }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().slice(0, 200);
    if (!t || items.length >= 12) return;
    onChange([...items, t]);
    setDraft("");
  };
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-lg font-bold text-ink">{title}</legend>
      {items.length === 0 ? <p className="m-0 text-muted-ink">{APPT.nothingYet}</p> : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {items.map((it, i) => (
          <li key={`${i}-${it}`} className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface p-3">
            <span className="min-w-0">{it}</span>
            <Button kind="tertiary" aria-label={`${APPT.removeItem}: ${it}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <X aria-hidden="true" className="size-5" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <label htmlFor={id} className="text-sm font-bold">
            {addLabel}
          </label>
          <input
            id={id}
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
          <Plus aria-hidden="true" className="size-5" />
          {APPT.addItem}
        </Button>
      </div>
    </fieldset>
  );
}
