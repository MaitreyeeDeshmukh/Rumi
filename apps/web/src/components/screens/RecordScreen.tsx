"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Mic } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { APPT } from "@/content/appointments";
import { dayLong, newId } from "@/features/appointments/appointments";
import type { RumiState, Visit } from "@/features/shared/types";
import { fill } from "@/lib/fill";
import { PAGES } from "@/lib/pages";
import { canRecord, recordAndTranscribe } from "@/lib/recordSpeech";
import { useRumi } from "@/lib/rumiActive";
import { MAX_VISITS, MAX_VISIT_CHARS } from "@/lib/storage-schema";

/** One recording lasts at most 60 s. A new one starts before that, so a long visit becomes a list of text parts. */
const CHUNK_MS = 50_000;
/** The old part keeps recording a moment after the new one starts, so no word is lost at the join (one may repeat). */
const OVERLAP_MS = 800;
const MAX_CHUNKS = 70;

type Phase = "idle" | "recording" | "working" | "saved";

/** /record: records the visit in parts, shows the words as they come, saves them on this device. */
export function RecordScreen() {
  const apptId = useSearchParams().get("appt") ?? "";
  const { state, update, hydrated } = useRumi();
  const appt = (state.appointments ?? []).find((x) => x.id === apptId);

  const supported = useSyncExternalStore(() => () => {}, canRecord, () => true);
  const [phase, setPhase] = useState("idle" as Phase);
  const [parts, setParts] = useState([] as string[]);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [savedId, setSavedId] = useState("");

  const keep = useRef(false);
  const active = useRef(0);
  const count = useRef(0);
  const stops = useRef([] as (() => void)[]);
  const timer = useRef(null as ReturnType<typeof setTimeout> | null);

  const finishIfDone = () => {
    if (!keep.current && active.current === 0) setPhase((p) => (p === "working" ? "idle" : p));
  };

  const startPart = () => {
    const n = count.current++;
    active.current++;
    const stop = recordAndTranscribe(
      (text) =>
        setParts((prev) => {
          const next = [...prev];
          next[n] = text;
          return next;
        }),
      (why) => {
        active.current--;
        if (why === "denied") {
          keep.current = false;
          if (timer.current) clearTimeout(timer.current);
          setNote(APPT.denied);
          setPhase("idle");
          return;
        }
        if (why === "failed") setNote(APPT.failed);
        finishIfDone();
      },
    );
    stops.current.push(stop);
    timer.current = setTimeout(() => {
      if (!keep.current) return;
      if (count.current >= MAX_CHUNKS) return stopAll();
      startPart();
      setTimeout(stop, OVERLAP_MS);
    }, CHUNK_MS);
  };

  const stopAll = () => {
    keep.current = false;
    if (timer.current) clearTimeout(timer.current);
    setPhase(active.current > 0 ? "working" : "idle");
    stops.current.forEach((s) => s());
    stops.current = [];
  };

  const start = () => {
    setNote("");
    keep.current = true;
    setPhase("recording");
    startPart();
  };

  useEffect(
    () => () => {
      keep.current = false;
      if (timer.current) clearTimeout(timer.current);
      stops.current.forEach((s) => s());
    },
    [],
  );

  const text = [...parts.filter(Boolean), typed.trim()].filter(Boolean).join("\n").slice(0, MAX_VISIT_CHARS);

  const save = () => {
    if (!text) return setNote(APPT.emptyVisit);
    const visit: Visit = { id: newId("v"), ...(appt ? { apptId: appt.id } : {}), createdAt: new Date().toISOString(), text };
    update((d: RumiState) => {
      d.visits = [...(d.visits ?? []), visit].slice(-MAX_VISITS);
    });
    setSavedId(visit.id);
    setNote("");
    setPhase("saved");
  };

  const busy = phase === "recording" || phase === "working";

  return (
    <Screen title={PAGES["/record"].h1} lead={PAGES["/record"].lead}>
      <div data-needs-js>
        {!hydrated ? null : (
          <div className="grid gap-5">
            <Notice tone="info">
              <p>{APPT.consent}</p>
            </Notice>
            <p className="m-0 text-muted-ink">{appt ? fill(APPT.linkedTo, { name: appt.providerName, day: dayLong(appt.date) }) : APPT.noLink}</p>

            {phase === "saved" ? (
              <div className="grid gap-3">
                <Notice tone="success">
                  <p>{APPT.savedVisit}</p>
                </Notice>
                <ButtonLink kind="primary" arrow block href={`/remember?visit=${savedId}`}>
                  {APPT.gotoRecap}
                </ButtonLink>
                <p className="note m-0">{APPT.recapNote}</p>
                <ButtonLink kind="tertiary" href={appt ? `/appointment?id=${appt.id}` : "/appointments"}>
                  {APPT.allAppts}
                </ButtonLink>
              </div>
            ) : (
              <>
                {supported ? (
                  <div className="grid gap-2">
                    {phase === "recording" ? (
                      <Button kind="danger" block aria-pressed onClick={stopAll}>
                        <Mic aria-hidden="true" className="size-5" />
                        {APPT.stop}
                      </Button>
                    ) : (
                      <Button kind="primary" block disabled={phase === "working"} onClick={start}>
                        <Mic aria-hidden="true" className="size-5" />
                        {APPT.start}
                      </Button>
                    )}
                    <p role="status" className="m-0 min-h-6 font-bold">
                      {phase === "recording" ? APPT.recording : phase === "working" ? APPT.working : ""}
                    </p>
                  </div>
                ) : (
                  <Notice tone="warn">
                    <p>{APPT.unsupported}</p>
                  </Notice>
                )}

                <section aria-labelledby="rec-live" className="grid gap-2">
                  <h2 id="rec-live" className="m-0 text-xl">
                    {APPT.liveHeading}
                  </h2>
                  {parts.some(Boolean) ? (
                    <ol className="m-0 grid list-none gap-2 p-0" aria-live="polite">
                      {parts.map((p, i) =>
                        p ? (
                          <li key={i} className="rounded-card border border-line bg-surface p-3">
                            {p}
                          </li>
                        ) : null,
                      )}
                    </ol>
                  ) : (
                    <p className="m-0 text-muted-ink">{APPT.nothingHeard}</p>
                  )}
                </section>

                <Field id="rec-typed" label={`${APPT.typeHeading}. ${APPT.typeLabel}`}>
                  <textarea rows={5} maxLength={MAX_VISIT_CHARS} className={fieldControlClass} value={typed} onChange={(e) => setTyped(e.target.value)} />
                </Field>

                <p role="status" className="m-0 min-h-6 font-bold text-danger">
                  {note}
                </p>
                <Button kind={supported ? "secondary" : "primary"} block disabled={busy} onClick={save}>
                  {APPT.save}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}
