"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useCopy } from "@/components/getReady/useCopy";
import { Card, CheckRow, ConfirmDelete, LinkCard, Loading, NeedsJs, NotFound, PreviewNote, Section } from "@/components/more/parts";
import { Button, ButtonLink } from "@/components/ui/button";
import { fieldControlClass, Field } from "@/components/ui/field";
import { Copy, Mic, Pause, Play } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { SPEAKERS, VISIT_SUMMARY, VISITS } from "@/content/visits";
import { longDate, moreStore, newId, todayIso, addDaysIso, useMore, type Visit } from "@/features/more/store";
import { SAMPLE_VISIT } from "@/fixtures/sampleVisit";
import { fill } from "@/lib/fill";

const SAMPLE_ID = "sample";
const sampleVisit = (): Visit => ({ id: SAMPLE_ID, title: VISITS.sampleTitle, date: addDaysIso(-3), minutes: 12 });

/** /home/visits: record a visit, and every visit saved on this device plus the sample. */
export function VisitsList() {
  const s = useMore();
  const visits = s ? [...s.visits].sort((a, b) => b.date.localeCompare(a.date)) : [];
  return (
    <Screen title={VISITS.title} lead={VISITS.lead}>
      <PreviewNote />
      <NeedsJs>
        <ButtonLink kind="primary" href="/home/visits/record" block arrow>
          <Mic aria-hidden="true" className="size-5" />
          {VISITS.record}
        </ButtonLink>
        <Section title={VISITS.pastTitle}>
          {!s ? (
            <Loading />
          ) : (
            <div className="grid gap-3">
              {visits.map((v) => (
                <LinkCard
                  key={v.id}
                  href={`/home/visits/${v.id}`}
                  title={v.title}
                  text={`${longDate(v.date)} · ${fill(VISITS.minutes, { n: v.minutes })}`}
                  tag={VISITS.recordedTag}
                />
              ))}
              {visits.length === 0 ? <p className="m-0 text-muted-ink">{VISITS.noneYet}</p> : null}
              <LinkCard href={`/home/visits/${SAMPLE_ID}`} title={VISITS.sampleTitle} tag={VISITS.sampleTag} />
            </div>
          )}
        </Section>
      </NeedsJs>
    </Screen>
  );
}

const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** /home/visits/record: ask first, then a simulated recording with a timer. Stopping saves the visit. */
export function RecordVisit() {
  const s = useMore();
  const router = useRouter();
  const nameId = useId();
  const apptId = useId();
  const [consent, setConsent] = useState(false);
  const [tried, setTried] = useState(false);
  const [name, setName] = useState(VISITS.nameDefault as string);
  const [appt, setAppt] = useState("");
  const [phase, setPhase] = useState("ready" as "ready" | "on" | "paused");
  const [sec, setSec] = useState(0);
  const timer = useRef(null as ReturnType<typeof setInterval> | null);

  useEffect(() => {
    if (phase !== "on") return;
    timer.current = setInterval(() => setSec((x) => x + 1), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [phase]);

  const upcoming = s ? s.appointments.filter((a) => !a.done) : [];

  const stop = () => {
    const id = newId();
    const linked = appt || undefined;
    moreStore.update((st) => ({
      ...st,
      visits: [...st.visits, { id, title: name.trim() || VISITS.nameDefault, date: todayIso(), minutes: Math.max(1, Math.round(sec / 60)), apptId: linked }],
      appointments: linked ? st.appointments.map((a) => (a.id === linked ? { ...a, done: true } : a)) : st.appointments,
    }));
    router.push(`/home/visits/${id}`);
  };

  return (
    <Screen title={VISITS.recordTitle} lead={VISITS.recordLead}>
      <PreviewNote>{VISITS.previewMic}</PreviewNote>
      <NeedsJs>
        {phase === "ready" ? (
          <div className="grid gap-5">
            <Notice tone="warn" title={VISITS.askTitle}>
              <p>{VISITS.askText}</p>
              <p className="m-0 font-semibold">{VISITS.askSay}</p>
            </Notice>
            <CheckRow checked={consent} onChange={setConsent} label={VISITS.consent} />
            {tried && !consent ? (
              <p className="m-0 font-bold text-danger" role="alert">
                {VISITS.consentNeeded}
              </p>
            ) : null}
            <Field id={nameId} label={VISITS.nameLabel} hint={VISITS.nameHint}>
              <input className={fieldControlClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            {upcoming.length > 0 ? (
              <Field id={apptId} label={VISITS.apptLabel}>
                <select className={fieldControlClass} value={appt} onChange={(e) => setAppt(e.target.value)}>
                  <option value="">{VISITS.apptNone}</option>
                  {upcoming.map((a) => (
                    <option key={a.id} value={a.id}>
                      {`${a.kind} · ${longDate(a.date)}`}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Button
              kind="primary"
              block
              onClick={() => {
                setTried(true);
                if (consent) setPhase("on");
              }}
            >
              <Mic aria-hidden="true" className="size-5" />
              {VISITS.start}
            </Button>
          </div>
        ) : (
          <div className="grid gap-5">
            <Card className="grid justify-items-center gap-2 py-8 text-center">
              <p className="m-0 flex items-center gap-2 font-bold" role="status">
                <span aria-hidden="true" className={phase === "on" ? "size-3 rounded-full bg-danger" : "size-3 rounded-full bg-line-strong"} />
                {phase === "on" ? VISITS.recording : VISITS.paused}
              </p>
              <p className="m-0 text-5xl font-bold tabular-nums" aria-label={`${VISITS.timerLabel} ${mmss(sec)}`}>
                {mmss(sec)}
              </p>
            </Card>
            <div className="grid gap-3 sm:flex">
              <Button kind="secondary" onClick={() => setPhase(phase === "on" ? "paused" : "on")}>
                {phase === "on" ? <Pause aria-hidden="true" className="size-5" /> : <Play aria-hidden="true" className="size-5" />}
                {phase === "on" ? VISITS.pause : VISITS.resume}
              </Button>
              <Button kind="primary" onClick={stop}>
                {VISITS.stop}
              </Button>
            </div>
          </div>
        )}
      </NeedsJs>
    </Screen>
  );
}

const LINES = new Map(SAMPLE_VISIT.map((l) => [l.id, l]));

function SummaryItem({ text, lines }: { text: string; lines: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="grid gap-2">
      <span>{text}</span>
      <Button kind="tertiary" className="justify-self-start" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? VISITS.hideSource : VISITS.showSource}
      </Button>
      {open ? (
        <blockquote className="m-0 grid gap-1 rounded-control border-l-4 border-primary bg-lav p-3">
          {lines.map((id) => {
            const l = LINES.get(id);
            return l ? (
              <p key={id} className="m-0">
                <span className="font-bold">{`${SPEAKERS[l.speaker] ?? l.speaker}: `}</span>
                {l.text}
              </p>
            ) : null;
          })}
        </blockquote>
      ) : null}
    </li>
  );
}

const summaryText = (v: Visit): string =>
  [v.title, longDate(v.date), "", ...VISIT_SUMMARY.flatMap((sec) => [sec.title, ...sec.items.map((i) => `- ${i.text}`), ""])].join("\n").trim();

/** /home/visits/:id: the summary by section, each line traceable to the visit, plus the full visit. */
export function VisitDetail({ id }: { id: string }) {
  const s = useMore();
  const router = useRouter();
  const [full, setFull] = useState(false);
  const pre = useRef(null as HTMLDivElement | null);
  const { message, copy } = useCopy(VISITS.copied, VISITS.copyFailed);
  if (!s)
    return (
      <Screen title={VISITS.title} lead={VISITS.detailLead}>
        <Loading />
      </Screen>
    );
  const visit = id === SAMPLE_ID ? sampleVisit() : s.visits.find((v) => v.id === id);
  if (!visit)
    return (
      <Screen title={VISITS.title} lead={VISITS.detailLead}>
        <NotFound />
      </Screen>
    );
  return (
    <Screen title={visit.title} lead={VISITS.detailLead}>
      <p className="m-0 mb-4 text-muted-ink">{`${longDate(visit.date)} · ${fill(VISITS.minutes, { n: visit.minutes })}`}</p>
      <PreviewNote>{VISITS.previewSummary}</PreviewNote>
      <NeedsJs>
        <div ref={pre}>
          {VISIT_SUMMARY.map((sec) => (
            <Section key={sec.key} title={sec.title} className="mt-6">
              <Card>
                <ul className="m-0 grid gap-4 pl-5">
                  {sec.items.map((i) => (
                    <SummaryItem key={i.text} text={i.text} lines={i.lines} />
                  ))}
                </ul>
              </Card>
            </Section>
          ))}
        </div>
        <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
          <Button kind="secondary" onClick={() => copy(summaryText(visit), pre.current)}>
            <Copy aria-hidden="true" className="size-5" />
            {VISITS.copy}
          </Button>
          <ButtonLink kind="secondary" href="/get-ready">
            {VISITS.getReady}
          </ButtonLink>
        </div>
        <p role="status" className="m-0 mt-2 min-h-6 text-ink">
          {message}
        </p>
        <Section title={VISITS.fullVisit}>
          <Button kind="tertiary" className="justify-self-start" aria-expanded={full} onClick={() => setFull(!full)}>
            {full ? VISITS.hideFull : VISITS.showFull}
          </Button>
          {full ? (
            <Card>
              <ol className="m-0 grid gap-2 pl-0">
                {SAMPLE_VISIT.map((l) => (
                  <li key={l.id} className="list-none">
                    <span className="font-bold">{`${SPEAKERS[l.speaker] ?? l.speaker}: `}</span>
                    {l.text}
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </Section>
        <div className="mt-8">
          {visit.id === SAMPLE_ID ? (
            <p className="m-0 text-muted-ink">{VISITS.sampleNoDelete}</p>
          ) : (
            <ConfirmDelete
              label={VISITS.deleteVisit}
              confirm={VISITS.deleteConfirm}
              cancel={VISITS.deleteCancel}
              note={VISITS.deleteNote}
              onConfirm={() => {
                moreStore.update((st) => ({ ...st, visits: st.visits.filter((v) => v.id !== visit.id) }));
                router.replace("/home/visits");
              }}
            />
          )}
        </div>
      </NeedsJs>
    </Screen>
  );
}
