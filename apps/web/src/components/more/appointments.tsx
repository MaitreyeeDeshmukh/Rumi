"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useCopy } from "@/components/getReady/useCopy";
import { Card, CheckRow, ConfirmDelete, LinkCard, Loading, NeedsJs, NotFound, PreviewNote, Section } from "@/components/more/parts";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Copy } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { APPT_ACCOMS, APPT_KINDS, APPTS, SCRIPT } from "@/content/appointments";
import { clockTime, longDate, moreStore, newId, todayIso, useMore, type Appointment } from "@/features/more/store";
import { fill } from "@/lib/fill";
import { useRumi } from "@/lib/rumiActive";

const whenText = (a: Appointment): string => [longDate(a.date), a.time ? clockTime(a.time) : APPTS.noTime].join(" · ");

/** /home/appointments: coming up first, then done. */
export function AppointmentsList() {
  const s = useMore();
  const sorted = s ? [...s.appointments].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)) : [];
  const upcoming = sorted.filter((a) => !a.done);
  const done = sorted.filter((a) => a.done).reverse();
  return (
    <Screen title={APPTS.title} lead={APPTS.lead}>
      <PreviewNote />
      <NeedsJs>
        <ButtonLink kind="primary" href="/home/appointments/new" block arrow>
          {APPTS.add}
        </ButtonLink>
        {!s ? (
          <Loading />
        ) : sorted.length === 0 ? (
          <div className="mt-6">
            <EmptyState title={APPTS.emptyTitle}>{APPTS.emptyText}</EmptyState>
          </div>
        ) : (
          <>
            {upcoming.length > 0 ? (
              <Section title={APPTS.upcoming}>
                {upcoming.map((a) => (
                  <LinkCard key={a.id} href={`/home/appointments/${a.id}`} title={a.kind} text={whenText(a)} tag={a.booked ? APPTS.booked : APPTS.needsCall} />
                ))}
              </Section>
            ) : null}
            {done.length > 0 ? (
              <Section title={APPTS.past}>
                {done.map((a) => (
                  <LinkCard key={a.id} href={`/home/appointments/${a.id}`} title={a.kind} text={whenText(a)} />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </NeedsJs>
    </Screen>
  );
}

type Errors = Partial<Record<"kind" | "kindOther" | "reason" | "date", string>>;

/** /home/appointments/new: one short form. Kind, reason and date are needed. */
export function NewAppointment() {
  const router = useRouter();
  const ids = { other: useId(), reason: useId(), provider: useId(), date: useId(), time: useId() };
  const [kind, setKind] = useState("");
  const [other, setOther] = useState("");
  const [reason, setReason] = useState("");
  const [provider, setProvider] = useState("");
  const [mode, setMode] = useState("in_person");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [booked, setBooked] = useState("yes");
  const [accom, setAccom] = useState([] as string[]);
  const [errors, setErrors] = useState({} as Errors);

  const save = () => {
    const e: Errors = {};
    if (!kind) e.kind = APPTS.errKind;
    if (kind === "Other" && !other.trim()) e.kindOther = APPTS.errKindOther;
    if (!reason.trim()) e.reason = APPTS.errReason;
    if (!date) e.date = APPTS.errDate;
    setErrors(e);
    if (Object.keys(e).length > 0) {
      window.scrollTo({ top: 0 });
      return;
    }
    const id = newId();
    const appt: Appointment = {
      id,
      kind: kind === "Other" ? other.trim() : kind,
      provider: provider.trim(),
      date,
      time,
      mode: mode === "virtual" ? "virtual" : "in_person",
      reason: reason.trim(),
      accom,
      booked: booked === "yes",
      done: false,
    };
    moreStore.update((st) => ({ ...st, appointments: [...st.appointments, appt] }));
    router.replace(`/home/appointments/${id}`);
  };

  return (
    <Screen title={APPTS.newTitle} lead={APPTS.newLead}>
      <PreviewNote />
      <NeedsJs>
        <div className="grid gap-6">
          {Object.keys(errors).length > 0 ? (
            <Notice tone="warn">
              <p role="alert" className="m-0">
                {APPTS.fixErrors}
              </p>
            </Notice>
          ) : null}
          <div className="grid gap-2">
            <Segmented label={APPTS.kindLegend} showLabel value={kind} onValueChange={setKind} options={APPT_KINDS.map((k) => ({ value: k, label: k }))} />
            {errors.kind ? <p className="m-0 text-sm font-bold text-danger">{errors.kind}</p> : null}
          </div>
          {kind === "Other" ? (
            <Field id={ids.other} label={APPTS.kindOther} error={errors.kindOther}>
              <input className={fieldControlClass} value={other} maxLength={60} onChange={(e) => setOther(e.target.value)} />
            </Field>
          ) : null}
          <Field id={ids.reason} label={APPTS.reason} hint={APPTS.reasonHint} error={errors.reason}>
            <textarea className={fieldControlClass} rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field id={ids.provider} label={APPTS.provider} hint={APPTS.providerHint}>
            <input className={fieldControlClass} value={provider} maxLength={80} onChange={(e) => setProvider(e.target.value)} />
          </Field>
          <Segmented
            label={APPTS.modeLegend}
            showLabel
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "in_person", label: APPTS.inPerson },
              { value: "virtual", label: APPTS.virtual },
            ]}
          />
          <Field id={ids.date} label={APPTS.date} error={errors.date}>
            <input type="date" className={fieldControlClass} min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id={ids.time} label={APPTS.time} hint={APPTS.timeHint}>
            <input type="time" className={fieldControlClass} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Segmented
            label={APPTS.bookedLegend}
            showLabel
            value={booked}
            onValueChange={setBooked}
            options={[
              { value: "yes", label: APPTS.bookedYes },
              { value: "no", label: APPTS.bookedNo },
            ]}
          />
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 font-bold text-ink">{APPTS.accomLegend}</legend>
            <p className="m-0 text-sm text-muted-ink">{APPTS.accomHint}</p>
            {APPT_ACCOMS.map((x) => (
              <CheckRow key={x} label={x} checked={accom.includes(x)} onChange={(on) => setAccom(on ? [...accom, x] : accom.filter((y) => y !== x))} />
            ))}
          </fieldset>
          <Button kind="primary" block onClick={save}>
            {APPTS.save}
          </Button>
        </div>
      </NeedsJs>
    </Screen>
  );
}

/** The call script, built from the appointment and the name in Settings. */
export function callScript(a: Appointment, name: string): string {
  const kind = a.kind.toLowerCase();
  const lines = [
    fill(SCRIPT.hello, { name: name || SCRIPT.you }),
    fill(SCRIPT.want, { article: /^[aeiou]/.test(kind) ? "an" : "a", kind }),
  ];
  if (a.reason) lines.push(fill(SCRIPT.reason, { reason: a.reason.replace(/[.!?]+$/, "").replace(/^./, (c) => c.toLowerCase()) }));
  if (a.provider) lines.push(fill(SCRIPT.provider, { provider: a.provider }));
  lines.push(a.mode === "virtual" ? SCRIPT.virtual : SCRIPT.inPerson);
  if (a.date) lines.push(fill(a.time ? SCRIPT.dateTime : SCRIPT.date, { date: longDate(a.date), time: a.time ? clockTime(a.time) : "" }));
  if (a.accom.length) lines.push(fill(SCRIPT.accom, { list: a.accom.map((x) => x.toLowerCase()).join(", and ") }));
  lines.push(SCRIPT.repeat);
  return lines.join("\n");
}

function CallScript({ appt }: { appt: Appointment }) {
  const { state } = useRumi();
  const pre = useRef(null as HTMLPreElement | null);
  const { message, copy } = useCopy(APPTS.scriptCopied, APPTS.scriptCopyFailed);
  const text = callScript(appt, state.settings.name);
  return (
    <Section title={APPTS.scriptTitle}>
      <p className="m-0 text-muted-ink">{APPTS.scriptLead}</p>
      <pre ref={pre} className="m-0 whitespace-pre-wrap break-words rounded-card border-2 border-line-strong bg-surface p-4 font-[inherit] text-base text-ink">
        {text}
      </pre>
      <div className="flex flex-wrap gap-3">
        <Button kind="secondary" onClick={() => copy(text, pre.current)}>
          <Copy aria-hidden="true" className="size-5" />
          {APPTS.scriptCopy}
        </Button>
        <Button kind="secondary" onClick={() => moreStore.update((st) => ({ ...st, appointments: st.appointments.map((x) => (x.id === appt.id ? { ...x, booked: true } : x)) }))}>
          {APPTS.markBooked}
        </Button>
      </div>
      <p role="status" className="m-0 min-h-6 text-ink">
        {message}
      </p>
    </Section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm font-bold text-muted-ink">{label}</dt>
      <dd className="m-0 text-ink">{value}</dd>
    </div>
  );
}

/** /home/appointments/:id: the details, what to do next, and the call script while it needs a call. */
export function AppointmentDetail({ id }: { id: string }) {
  const s = useMore();
  const router = useRouter();
  if (!s)
    return (
      <Screen title={APPTS.title} lead={APPTS.lead}>
        <Loading />
      </Screen>
    );
  const a = s.appointments.find((x) => x.id === id);
  if (!a)
    return (
      <Screen title={APPTS.title} lead={APPTS.lead}>
        <NotFound />
      </Screen>
    );
  const set = (patch: { [K in keyof Appointment]?: Appointment[K] }) =>
    moreStore.update((st) => ({ ...st, appointments: st.appointments.map((x) => (x.id === a.id ? { ...x, ...patch } : x)) }));
  return (
    <Screen title={a.kind} lead={whenText(a)}>
      <PreviewNote />
      <NeedsJs>
        <Card>
          <dl className="m-0 grid gap-3">
            <Row label={APPTS.when} value={whenText(a)} />
            <Row label={APPTS.where} value={a.mode === "virtual" ? APPTS.virtual : APPTS.inPerson} />
            {a.provider ? <Row label={APPTS.with} value={a.provider} /> : null}
            <Row label={APPTS.why} value={a.reason} />
            {a.accom.length > 0 ? <Row label={APPTS.asks} value={a.accom.join(", ")} /> : null}
          </dl>
        </Card>
        {!a.booked && !a.done ? <CallScript appt={a} /> : null}
        <div className="mt-6 grid gap-3">
          {!a.done ? (
            <>
              <ButtonLink kind="primary" href="/get-ready" block arrow>
                {APPTS.getReady}
              </ButtonLink>
              <ButtonLink kind="secondary" href="/practice" block>
                {APPTS.practice}
              </ButtonLink>
              <ButtonLink kind="secondary" href="/home/visits/record" block>
                {APPTS.record}
              </ButtonLink>
            </>
          ) : null}
          <Button kind="secondary" block onClick={() => set({ done: !a.done })}>
            {a.done ? APPTS.markNotDone : APPTS.markDone}
          </Button>
        </div>
        <div className="mt-8">
          <ConfirmDelete
            label={APPTS.deleteAppt}
            confirm={APPTS.deleteConfirm}
            cancel={APPTS.deleteCancel}
            note={APPTS.deleteNote}
            onConfirm={() => {
              moreStore.update((st) => ({ ...st, appointments: st.appointments.filter((x) => x.id !== a.id) }));
              router.replace("/home/appointments");
            }}
          />
        </div>
      </NeedsJs>
    </Screen>
  );
}
