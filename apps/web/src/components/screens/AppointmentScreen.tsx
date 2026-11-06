"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CallScriptBox, ListEditor } from "@/components/appointments/parts";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { APPT } from "@/content/appointments";
import { callScript, dayLong, timeText } from "@/features/appointments/appointments";
import type { Appointment, RumiState } from "@/features/shared/types";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

type NoteKey = "questions" | "bring" | "symptoms";

/** /appointment?id=...: the facts, the call script, the notes to prepare, and the ways on (practice, record). */
export function AppointmentScreen() {
  const id = useSearchParams().get("id") ?? "";
  const { state, update, hydrated } = useRumi();
  const [asking, setAsking] = useState(false);
  const [gone, setGone] = useState(false);
  const a = (state.appointments ?? []).find((x) => x.id === id);
  const visits = (state.visits ?? []).filter((v) => v.apptId === id);

  const change = (fn: (x: Appointment) => void) =>
    update((d: RumiState) => {
      const x = (d.appointments ?? []).find((y) => y.id === id);
      if (x) fn(x);
    });
  const setNotes = (key: NoteKey, next: string[]) => change((x) => (x[key] = next));
  const remove = () => {
    update((d: RumiState) => {
      d.appointments = (d.appointments ?? []).filter((x) => x.id !== id);
      d.visits = (d.visits ?? []).filter((v) => v.apptId !== id);
    });
    setGone(true);
  };

  return (
    <Screen title={PAGES["/appointment"].h1} lead={PAGES["/appointment"].lead}>
      <div data-needs-js>
        {!hydrated ? null : !a || gone ? (
          <div className="grid gap-4">
            <Notice tone="info" title={APPT.notFoundTitle}>
              <p>{APPT.notFoundBody}</p>
            </Notice>
            <ButtonLink kind="secondary" href="/appointments">
              {APPT.allAppts}
            </ButtonLink>
          </div>
        ) : (
          <div className="grid gap-7">
            <section aria-labelledby="appt-facts" className="grid gap-1 rounded-card border border-line bg-surface p-5">
              <h2 id="appt-facts" className="mt-0 mb-2 text-xl">
                {APPT.factsHeading}
              </h2>
              <p className="m-0">
                <strong>{APPT.when}:</strong> {dayLong(a.date)} at {timeText(a.time)}
              </p>
              <p className="m-0">
                <strong>{APPT.where}:</strong> {a.providerName}, {a.clinic}
              </p>
              <p className="m-0">
                <strong>{APPT.care[a.care]}</strong>
                {a.reason ? `. ${APPT.reason}: ${a.reason}` : ""}
              </p>
              <p className="m-0">
                <strong>{APPT.status}:</strong> {a.status === "confirmed" ? APPT.confirmed : APPT.toConfirm}
              </p>
              {a.status === "to_confirm" ? (
                <div className="mt-2">
                  <Button kind="secondary" onClick={() => change((x) => (x.status = "confirmed"))}>
                    {APPT.markConfirmed}
                  </Button>
                </div>
              ) : null}
              <p className="note mt-3 mb-0">{APPT.honest}</p>
            </section>

            <CallScriptBox initial={callScript(a, state.settings.name)} />

            <section id="prep" aria-labelledby="appt-prep" className="grid gap-4">
              <div>
                <h2 id="appt-prep" className="mt-0 mb-1 text-xl">
                  {APPT.prepHeading}
                </h2>
                <p className="m-0 text-muted-ink">{APPT.prepLead}</p>
              </div>
              <ListEditor title={APPT.questions} addLabel={APPT.questionsAdd} items={a.questions} onChange={(n) => setNotes("questions", n)} />
              <ListEditor title={APPT.bring} addLabel={APPT.bringAdd} items={a.bring} onChange={(n) => setNotes("bring", n)} />
              <ListEditor title={APPT.symptoms} addLabel={APPT.symptomsAdd} items={a.symptoms} onChange={(n) => setNotes("symptoms", n)} />
            </section>

            <div className="grid gap-3">
              <ButtonLink kind="primary" arrow block href="/practice">
                {APPT.practice}
              </ButtonLink>
              <ButtonLink kind="secondary" block href={`/record?appt=${a.id}`}>
                {APPT.recordVisit}
              </ButtonLink>
            </div>

            <section aria-labelledby="appt-visits" className="grid gap-2">
              <h2 id="appt-visits" className="m-0 text-xl">
                {APPT.visitsHeading}
              </h2>
              {visits.length === 0 ? <p className="m-0 text-muted-ink">{APPT.noVisits}</p> : null}
              {visits.map((v) => (
                <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface p-3">
                  <span>{new Date(v.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                  <ButtonLink kind="secondary" href={`/remember?visit=${v.id}`}>
                    {APPT.makeRecap}
                  </ButtonLink>
                </div>
              ))}
            </section>

            <div className="grid gap-3">
              {asking ? (
                <Notice tone="warn" title={APPT.deleteAsk}>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <Button kind="danger" onClick={remove}>
                      {APPT.deleteYes}
                    </Button>
                    <Button kind="secondary" onClick={() => setAsking(false)}>
                      {APPT.deleteNo}
                    </Button>
                  </div>
                </Notice>
              ) : (
                <Button kind="urgent" onClick={() => setAsking(true)}>
                  {APPT.delete}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
