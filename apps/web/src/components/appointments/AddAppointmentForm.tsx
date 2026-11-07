"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { Field, fieldControlClass } from "@/components/ui/field";
import { APPT } from "@/content/appointments";
import { CARE_KEYS, buildAddedAppointment, newId } from "@/features/appointments/appointments";
import type { CareType, RumiState } from "@/features/shared/types";
import { useRumi } from "@/lib/rumiActive";
import { MAX_APPOINTMENTS } from "@/lib/storage-schema";

/** Type in an appointment you already have (from a letter, email or phone call). Nothing is sent to anyone. */
export function AddAppointmentForm() {
  const { update } = useRumi();
  const router = useRouter();
  const [care, setCare] = useState("other");
  const [who, setWho] = useState("");
  const [place, setPlace] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");

  const save = () => {
    if (!who.trim()) return setProblem(APPT.needWho);
    if (!date || !time) return setProblem(APPT.needWhen);
    const a = buildAddedAppointment({ care: care as CareType, who, place, date, time, reason }, newId("a"), new Date());
    update((d: RumiState) => {
      d.appointments = [...(d.appointments ?? []), a].slice(-MAX_APPOINTMENTS);
    });
    router.push(`/appointment?id=${a.id}`);
  };

  return (
    <div className="grid max-w-2xl gap-5">
      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="mb-1 p-0 text-xl font-bold text-ink">{APPT.step1}</legend>
        <ChoiceGroup aria-label={APPT.step1} value={care} onValueChange={(v: string) => setCare(v)}>
          {CARE_KEYS.map((k) => (
            <ChoiceCard key={k} value={k} title={APPT.care[k]} />
          ))}
        </ChoiceGroup>
      </fieldset>
      <Field id="add-who" label={APPT.whoLabel} hint={APPT.whoHint}>
        <input maxLength={80} className={fieldControlClass} value={who} onChange={(e) => (setWho(e.target.value), setProblem(""))} />
      </Field>
      <Field id="add-place" label={APPT.placeLabel} hint={APPT.placeHint}>
        <input maxLength={200} className={fieldControlClass} value={place} onChange={(e) => setPlace(e.target.value)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="add-date" label={APPT.dateLabel}>
          <input type="date" className={fieldControlClass} value={date} onChange={(e) => (setDate(e.target.value), setProblem(""))} />
        </Field>
        <Field id="add-time" label={APPT.timeLabel}>
          <input type="time" className={fieldControlClass} value={time} onChange={(e) => (setTime(e.target.value), setProblem(""))} />
        </Field>
      </div>
      <Field id="add-reason" label={APPT.reasonLabel} hint={APPT.reasonHint}>
        <input maxLength={200} className={fieldControlClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p role="alert" className="m-0 min-h-6 font-bold text-danger">
        {problem}
      </p>
      <div>
        <Button kind="primary" arrow onClick={save}>
          {APPT.saveAdded}
        </Button>
      </div>
    </div>
  );
}
