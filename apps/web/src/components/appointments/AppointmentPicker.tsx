"use client";

import Link from "next/link";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { APPT } from "@/content/appointments";
import { dayLong, splitAppointments, timeText, whereLine } from "@/features/appointments/appointments";
import type { Appointment } from "@/features/shared/types";

export const PICK_NONE = "none";

/**
 * "Which appointment is this for?" Upcoming visits first (soonest first), then past ones (latest first).
 * Used by Record, Remember and anywhere a screen starts from one of the person's appointments.
 * `extra` adds more choices at the end (such as "None of these" or the sample visit).
 */
export function AppointmentPicker({
  appointments,
  value,
  onChange,
  legend = APPT.pickAppt,
  note,
  extra,
  now,
}: {
  appointments: readonly Appointment[];
  value: string;
  onChange: (id: string) => void;
  legend?: string;
  /** A short line under each appointment, such as how many recordings it has. */
  note?: (a: Appointment) => string | null;
  extra?: readonly { value: string; title: string; hint?: string }[];
  now: Date;
}) {
  const { upcoming, past } = splitAppointments(appointments, now);
  const list = [...upcoming, ...past];
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0">
      <legend className="mb-1 p-0 text-xl font-bold text-ink">{legend}</legend>
      {list.length === 0 ? (
        <p className="m-0">
          {APPT.pickEmpty} <Link href="/appointments/new">{APPT.pickAdd}</Link>
        </p>
      ) : null}
      <ChoiceGroup aria-label={legend} value={value} onValueChange={onChange}>
        {list.map((a) => (
          <ChoiceCard key={a.id} value={a.id} title={whereLine(a)}>
            {dayLong(a.date)} at {timeText(a.time)}
            {note?.(a) ? ` · ${note(a)}` : ""}
          </ChoiceCard>
        ))}
        {(extra ?? []).map((e) => (
          <ChoiceCard key={e.value} value={e.value} title={e.title}>
            {e.hint}
          </ChoiceCard>
        ))}
      </ChoiceGroup>
    </fieldset>
  );
}
