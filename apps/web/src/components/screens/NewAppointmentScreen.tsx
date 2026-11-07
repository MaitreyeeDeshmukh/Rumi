"use client";

import { useState } from "react";
import { AddAppointmentForm } from "@/components/appointments/AddAppointmentForm";
import { ScanAppointment } from "@/components/appointments/ScanAppointment";
import { CallScriptBox, downloadIcs } from "@/components/appointments/parts";
import { Button, ButtonLink } from "@/components/ui/button";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { APPT } from "@/content/appointments";
import { SCAN } from "@/content/appointmentScan";
import {
  CARE_KEYS,
  buildAppointment,
  callScript,
  dayLong,
  dayShort,
  newId,
  providersFor,
  slotsFor,
  timeText,
} from "@/features/appointments/appointments";
import type { Appointment, CareType, RumiState } from "@/features/shared/types";
import { fill } from "@/lib/fill";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";
import { MAX_APPOINTMENTS } from "@/lib/storage-schema";

/** /appointments/new: pick care, pick a made-up doctor, pick a time, save. Nothing is sent to anyone. */
export function NewAppointmentScreen() {
  const { state, update, hydrated } = useRumi();
  const [now] = useState(() => new Date());
  const [step, setStep] = useState(1);
  const [care, setCare] = useState("");
  const [providerId, setProviderId] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(null as Appointment | null);
  // First choice: read a letter or photo, type in an appointment you already have, or practice booking a pretend one.
  const [mode, setMode] = useState(null as "details" | "pretend" | "scan" | null);

  const providers = care ? providersFor(care as CareType) : [];
  const provider = providers.find((p) => p.id === providerId);
  const slots = provider ? slotsFor(provider, now) : [];
  const days = [...new Set(slots.map((s) => s.date))];
  const times = slots.filter((s) => s.date === day).map((s) => s.time);

  const go = (to: number) => {
    setProblem("");
    setStep(to);
  };
  const next = () => {
    if (step === 1 && !care) return setProblem(APPT.pickCare);
    if (step === 2 && !provider) return setProblem(APPT.pickProvider);
    go(step + 1);
  };
  const save = () => {
    if (!provider || !day || !time) return setProblem(APPT.pickSlot);
    const a = buildAppointment({ care: care as CareType, provider, slot: { date: day, time }, reason }, newId("a"), new Date());
    update((d: RumiState) => {
      d.appointments = [...(d.appointments ?? []), a].slice(-MAX_APPOINTMENTS);
    });
    setSaved(a);
  };

  if (saved) {
    return (
      <Screen title={APPT.savedTitle} lead={APPT.savedLead}>
        <div className="grid gap-6">
          <Notice tone="warn">
            <p>{APPT.honest}</p>
          </Notice>
          <p className="m-0 font-bold">
            {saved.providerName}, {dayLong(saved.date)} at {timeText(saved.time)}
          </p>
          <CallScriptBox initial={callScript(saved, state.settings.name)} />
          <div className="grid gap-3">
            <ButtonLink kind="primary" arrow block href="/get-ready">
              {APPT.getReady}
            </ButtonLink>
            <Button kind="secondary" block onClick={() => downloadIcs(saved)}>
              {APPT.addCalendar}
            </Button>
            <p className="note m-0">{APPT.calendarNote}</p>
            <ButtonLink kind="tertiary" href={`/appointment?id=${saved.id}`}>
              {APPT.details}
            </ButtonLink>
          </div>
        </div>
      </Screen>
    );
  }

  if (mode !== "pretend") {
    return (
      <Screen title={PAGES["/appointments/new"].h1} lead={PAGES["/appointments/new"].lead}>
        <div data-needs-js>
          {!hydrated ? null : mode === "details" ? (
            <AddAppointmentForm />
          ) : mode === "scan" ? (
            <ScanAppointment onType={() => setMode("details")} />
          ) : (
            <div className="grid max-w-2xl gap-4">
              <h2 className="m-0 text-xl">{APPT.howLead}</h2>
              <ChoiceGroup aria-label={APPT.howLead} value="" onValueChange={(v: string) => setMode(v === "pretend" ? "pretend" : v === "scan" ? "scan" : "details")}>
                <ChoiceCard value="scan" title={SCAN.way}>
                  {SCAN.wayHint}
                </ChoiceCard>
                <ChoiceCard value="details" title={APPT.haveDetails}>
                  {APPT.haveDetailsHint}
                </ChoiceCard>
                <ChoiceCard value="pretend" title={APPT.pretend}>
                  {APPT.pretendHint}
                </ChoiceCard>
              </ChoiceGroup>
            </div>
          )}
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={PAGES["/appointments/new"].h1} lead={PAGES["/appointments/new"].lead}>
      <div data-needs-js>
        {!hydrated ? null : (
          <div className="grid gap-5">
            <Notice tone="info">
              <p>{APPT.honest}</p>
              <p>{APPT.madeUp}</p>
            </Notice>
            <p className="m-0 font-bold">{fill(APPT.stepLabel, { n: step })}</p>

            {step === 1 && (
              <fieldset className="m-0 grid gap-3 border-0 p-0">
                <legend className="mb-1 p-0 text-xl font-bold text-ink">{APPT.step1}</legend>
                <ChoiceGroup
                  aria-label={APPT.step1}
                  value={care}
                  onValueChange={(v: string) => {
                    setCare(v);
                    setProviderId("");
                    setDay("");
                    setTime("");
                    setProblem("");
                  }}
                >
                  {CARE_KEYS.map((k) => (
                    <ChoiceCard key={k} value={k} title={APPT.care[k]} />
                  ))}
                </ChoiceGroup>
              </fieldset>
            )}

            {step === 2 && (
              <fieldset className="m-0 grid gap-3 border-0 p-0">
                <legend className="mb-1 p-0 text-xl font-bold text-ink">{APPT.step2}</legend>
                <ChoiceGroup
                  aria-label={APPT.step2}
                  value={providerId}
                  onValueChange={(v: string) => {
                    setProviderId(v);
                    setDay("");
                    setTime("");
                    setProblem("");
                  }}
                >
                  {providers.map((p) => (
                    <ChoiceCard key={p.id} value={p.id} title={p.name}>
                      {p.clinic}
                    </ChoiceCard>
                  ))}
                </ChoiceGroup>
              </fieldset>
            )}

            {step === 3 && (
              <div className="grid gap-5">
                <fieldset className="m-0 grid gap-3 border-0 p-0">
                  <legend className="mb-1 p-0 text-xl font-bold text-ink">{APPT.step3}</legend>
                  <p className="m-0 font-bold">{APPT.dayLegend}</p>
                  <ChoiceGroup
                    aria-label={APPT.dayLegend}
                    value={day}
                    onValueChange={(v: string) => {
                      setDay(v);
                      setTime("");
                      setProblem("");
                    }}
                  >
                    {days.map((d) => (
                      <ChoiceCard key={d} value={d} title={dayShort(d)} />
                    ))}
                  </ChoiceGroup>
                </fieldset>
                {day ? (
                  <fieldset className="m-0 grid gap-3 border-0 p-0">
                    <legend className="mb-1 p-0 font-bold text-ink">{APPT.timeLegend}</legend>
                    <ChoiceGroup
                      aria-label={APPT.timeLegend}
                      value={time}
                      onValueChange={(v: string) => {
                        setTime(v);
                        setProblem("");
                      }}
                    >
                      {times.map((t) => (
                        <ChoiceCard key={t} value={t} title={timeText(t)} />
                      ))}
                    </ChoiceGroup>
                  </fieldset>
                ) : null}
                <Field id="appt-reason" label={APPT.reasonLabel} hint={APPT.reasonHint}>
                  <input maxLength={200} className={fieldControlClass} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                {provider && day && time ? (
                  <div className="rounded-card border border-line bg-surface p-4">
                    <h2 className="mt-0 mb-1 text-lg">{APPT.reviewHeading}</h2>
                    <p className="m-0">{APPT.care[care as CareType]}</p>
                    <p className="m-0">
                      {provider.name}, {provider.clinic}
                    </p>
                    <p className="m-0">
                      {dayLong(day)} at {timeText(time)}
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            <p role="alert" className="m-0 min-h-6 font-bold text-danger">
              {problem}
            </p>
            <div className="flex flex-wrap gap-3">
              {step > 1 ? (
                <Button kind="secondary" onClick={() => go(step - 1)}>
                  {APPT.back}
                </Button>
              ) : null}
              {step < 3 ? (
                <Button kind="primary" arrow onClick={next}>
                  {APPT.next}
                </Button>
              ) : (
                <Button kind="primary" onClick={save}>
                  {APPT.confirmBook}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
