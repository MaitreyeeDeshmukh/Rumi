"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { DoctorAvatar } from "@/components/practice/DoctorAvatar";
import { Button } from "@/components/ui/button";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { Segmented } from "@/components/ui/segmented";
import { Upload } from "@/components/ui/icons";
import { APPT } from "@/content/appointments";
import { PRACTICE } from "@/content/practice";
import { dayLong, isoDate, splitAppointments } from "@/features/appointments/appointments";
import { preview } from "@/features/practice/sources";
import type { Appointment, VisitPlan, Visit } from "@/features/shared/types";
import { fill, plural } from "@/lib/fill";

/** What the person picked. A booked visit and a recording are named by id. */
export type Choice = { kind: "plan" } | { kind: "general" } | { kind: "appt"; id: string } | { kind: "visit"; id: string } | { kind: "file"; file: File };

type Source = "general" | "plan" | "visit" | "recording";

const MAX_ROWS = 6;

/**
 * The Practice start: the clinician, one row to say what you practice with, what that means, and one button.
 * Choose first, then go on. A list shows only for the choice that has one, so few things are on screen at a time.
 */
export function SourcePicker({
  plan,
  appointments,
  visits,
  busy,
  messages,
  onPick,
}: {
  plan: VisitPlan | undefined;
  appointments: readonly Appointment[];
  visits: readonly Visit[];
  /** The key of the choice being made (the plan call takes a moment), or null. */
  busy: string | null;
  /** One message per choice, keyed: appt-<id>, visit-<id>, file. */
  messages: Record<string, string>;
  onPick: (choice: Choice) => void;
}) {
  const fileInput = useRef(null as HTMLInputElement | null);
  const [source, setSource] = useState("general" as Source);
  const [apptId, setApptId] = useState("");
  const [visitId, setVisitId] = useState("");

  const lines = plan?.items.filter((i) => i.enabled).length ?? 0;
  const { past, upcoming } = splitAppointments(appointments, new Date());
  const visitList = [...past, ...upcoming].slice(0, MAX_ROWS);
  const recordings = [...visits].reverse().slice(0, MAX_ROWS);
  // The first one is chosen until the person picks another.
  const apptPick = visitList.some((a) => a.id === apptId) ? apptId : (visitList[0]?.id ?? "");
  const visitPick = recordings.some((v) => v.id === visitId) ? visitId : (recordings[0]?.id ?? "");
  const anyBusy = busy !== null;

  const choice: Choice | null =
    source === "general"
      ? { kind: "general" }
      : source === "plan"
        ? lines > 0
          ? { kind: "plan" }
          : null
        : source === "visit"
          ? apptPick
            ? { kind: "appt", id: apptPick }
            : null
          : visitPick
            ? { kind: "visit", id: visitPick }
            : null;
  const key = choice?.kind === "appt" ? `appt-${choice.id}` : choice?.kind === "visit" ? `visit-${choice.id}` : "";

  return (
    <div data-phase="empty" className="mx-auto mt-6 grid w-full max-w-3xl justify-items-center gap-5">
      <DoctorAvatar speaking={false} />

      <div className="[&_[role=radiogroup]]:justify-center">
        <Segmented
          label={PRACTICE.sourceLegend}
          value={source}
          onValueChange={(v) => setSource(v as Source)}
          options={[
            { value: "general", label: PRACTICE.generalTitle },
            { value: "plan", label: PRACTICE.myPlanTitle },
            { value: "visit", label: PRACTICE.visitsTitle },
            { value: "recording", label: PRACTICE.recordingsTitle },
          ]}
        />
      </div>

      <div className="grid min-h-28 w-full content-start justify-items-center gap-3 text-left">
        {source === "general" ? <p className="m-0 text-center">{PRACTICE.generalText}</p> : null}

        {source === "plan" ? (
          lines > 0 ? (
            <p className="m-0 text-center">{plural(lines, PRACTICE.planLines)}</p>
          ) : (
            <p className="m-0 text-center">
              {PRACTICE.planNone} <Link href="/get-ready">{PRACTICE.goGetReady}</Link>
            </p>
          )
        ) : null}

        {source === "visit" ? (
          visitList.length === 0 ? (
            <p className="m-0 text-center">
              {PRACTICE.visitsNone} <Link href="/appointments/new">{APPT.book}</Link>
            </p>
          ) : (
            <ChoiceGroup aria-label={PRACTICE.visitsTitle} value={apptPick} onValueChange={setApptId} className="grid w-full gap-2">
              {visitList.map((a) => (
                <ChoiceCard key={a.id} value={a.id} title={`${APPT.care[a.care]} with ${a.providerName}`} disabled={anyBusy}>
                  {dayLong(a.date)}
                </ChoiceCard>
              ))}
            </ChoiceGroup>
          )
        ) : null}

        {source === "recording" ? (
          <>
            {recordings.length === 0 ? (
              <p className="m-0 text-center">
                {PRACTICE.recordingsNone} <Link href="/record">{PRACTICE.recordUse}</Link>
              </p>
            ) : (
              <ChoiceGroup aria-label={PRACTICE.recordingsTitle} value={visitPick} onValueChange={setVisitId} className="grid w-full gap-2">
                {recordings.map((v) => (
                  <ChoiceCard key={v.id} value={v.id} title={fill(PRACTICE.recordingName, { day: dayLong(isoDate(new Date(v.createdAt))) })} disabled={anyBusy}>
                    {preview(v, 70)}
                  </ChoiceCard>
                ))}
              </ChoiceGroup>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.md,text/plain,audio/*"
              className="sr-only"
              tabIndex={-1}
              aria-label={PRACTICE.fileChoose}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onPick({ kind: "file", file });
              }}
            />
            <Button kind="secondary" loading={busy === "file"} loadingLabel={PRACTICE.fileWorking} disabled={anyBusy} onClick={() => fileInput.current?.click()}>
              <Upload aria-hidden="true" className="size-5" />
              {PRACTICE.fileChoose}
            </Button>
            <p className="note m-0 text-center">
              {PRACTICE.fileText} {PRACTICE.fileNote} <Link href="/privacy">Privacy</Link>
            </p>
            <p role="status" className="note m-0 empty:hidden">
              {messages.file}
            </p>
          </>
        ) : null}

        <p role="status" className="note m-0 empty:hidden">
          {key ? messages[key] : ""}
        </p>
      </div>

      <Button
        kind="primary"
        arrow
        className="min-h-14 px-10 text-lg"
        disabled={choice === null || anyBusy}
        loading={busy !== null && busy !== "file"}
        loadingLabel={PRACTICE.makingLines}
        onClick={() => choice && onPick(choice)}
      >
        {PRACTICE.sourceNext}
      </Button>
    </div>
  );
}
