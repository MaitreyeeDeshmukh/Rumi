"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useCrisis } from "@/components/CrisisProvider";
import { useCopy } from "@/components/getReady/useCopy";
import { Card, Loading, NeedsJs, PreviewNote, Section } from "@/components/more/parts";
import { ReachButtons } from "@/components/more/you";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Field, fieldControlClass } from "@/components/ui/field";
import { ArrowLeft, Check, Copy, Info, ShieldAlert } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { FLOWS, RESCUE, SAY_GOALS, SAY_TEMPLATES, SAY_WHO, TRUSTED_MESSAGE } from "@/content/rescue";
import { useMore } from "@/features/more/store";
import { crisisTier } from "@/lib/crisis";
import { fill } from "@/lib/fill";
import { useRumi } from "@/lib/rumiActive";

/** Always at the bottom of Rescue: where to get real help, because Rumi cannot call anyone. */
function EmergencyLine() {
  return (
    <div className="mt-8 grid gap-3 rounded-card border-2 border-danger bg-surface p-4 text-ink">
      <p className="m-0 flex items-start gap-2 font-bold">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
        <span>{RESCUE.emergency}</span>
      </p>
      <p className="m-0 text-sm text-muted-ink">{RESCUE.noEmergency}</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink kind="urgent" href="tel:911">
          {RESCUE.call911}
        </ButtonLink>
        <ButtonLink kind="urgent" href="tel:988">
          {RESCUE.call988}
        </ButtonLink>
        <ButtonLink kind="urgent" href="sms:988">
          {RESCUE.text988}
        </ButtonLink>
      </div>
    </div>
  );
}

/** A big, calm option. */
function Option({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center justify-between gap-3 rounded-card border-2 border-line-strong bg-surface px-4 py-3 text-lg font-bold text-ink no-underline hover:border-primary hover:bg-primary-soft"
    >
      <span>{label}</span>
      <ArrowLeft aria-hidden="true" className="size-5 shrink-0 rotate-180 text-primary" />
    </Link>
  );
}

function Shell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <Screen title={title} lead={lead}>
      <PreviewNote>{RESCUE.preview}</PreviewNote>
      <NeedsJs>{children}</NeedsJs>
      <EmergencyLine />
    </Screen>
  );
}

const has = (t: string, words: readonly string[]) => words.some((w) => t.includes(w));

/** Where a typed message should go. Simple word matching, on the device. */
export function routeFor(text: string): string {
  const t = text.toLowerCase();
  if (has(t, ["bus", "train", "ride", "late", "missed", "uber", "lyft"])) return "/home/rescue/flow/bus";
  if (has(t, ["appointment", "doctor", "dentist", "resched", "clinic"])) return "/home/rescue/say/reception-reschedule";
  if (has(t, ["lost", "where am i", "confus", "can't find", "cannot find"])) return "/home/rescue/flow/lost";
  if (has(t, ["overwhelm", "too much", "stress", "panic", "loud", "crowd", "noise"])) return "/home/rescue/over";
  if (has(t, ["say", "call", "talk", "ask", "phone", "receptionist", "text"])) return "/home/rescue/say";
  return "/home/rescue/unsure";
}

/** /home/rescue */
export function RescueHome() {
  const router = useRouter();
  const { show } = useCrisis();
  const inputId = useId();
  const [text, setText] = useState("");
  const [maybe, setMaybe] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const tier = crisisTier(t);
    if (tier === "certain") {
      show();
      return;
    }
    if (tier === "check") {
      setMaybe(true);
      return;
    }
    router.push(routeFor(t));
  };
  return (
    <Shell title={RESCUE.title} lead={RESCUE.lead}>
      <div className="grid gap-3">
        <Option href="/home/rescue/changed" label={RESCUE.options.changed} />
        <Option href="/home/rescue/unsure" label={RESCUE.options.unsure} />
        <Option href="/home/rescue/say" label={RESCUE.options.talk} />
        <Option href="/home/rescue/flow/lost" label={RESCUE.options.lost} />
        <Option href="/home/rescue/over" label={RESCUE.options.over} />
      </div>
      <form onSubmit={submit} className="mt-6 grid gap-3">
        <Field id={inputId} label={RESCUE.typeLabel} hint={RESCUE.typeHint}>
          <input className={fieldControlClass} value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Button kind="secondary" type="submit" disabled={!text.trim()}>
          {RESCUE.go}
        </Button>
      </form>
      {maybe ? (
        <Notice tone="warn" title={RESCUE.maybeCrisisTitle} className="mt-4">
          <p className="m-0">{RESCUE.maybeCrisis}</p>
        </Notice>
      ) : null}
      <div className="mt-6">
        <ButtonLink kind="secondary" href="/home/rescue/trusted" block>
          {RESCUE.trusted}
        </ButtonLink>
      </div>
    </Shell>
  );
}

/** /home/rescue/changed */
export function Changed() {
  return (
    <Shell title={RESCUE.changedTitle} lead={RESCUE.changedLead}>
      <div className="grid gap-3">
        <Option href="/home/rescue/flow/bus" label={RESCUE.changed.bus} />
        <Option href="/home/rescue/say/reception-reschedule" label={RESCUE.changed.appt} />
        <Option href="/home/rescue/say/friend-cancelplan" label={RESCUE.changed.plans} />
        <Option href="/home/rescue/unsure" label={RESCUE.changed.other} />
      </div>
    </Shell>
  );
}

/** /home/rescue/flow/:id: one step on the screen at a time, with Help me and Go back. */
export function RescueFlow({ id }: { id: string }) {
  const flow = FLOWS[id];
  const [hist, setHist] = useState([0]);
  const [help, setHelp] = useState(false);
  const heading = useRef(null as HTMLParagraphElement | null);
  const idx = hist[hist.length - 1] ?? 0;
  useEffect(() => {
    if (hist.length > 1) heading.current?.focus();
  }, [hist]);
  const st = flow?.steps[idx];
  if (!flow || !st) return <Changed />;
  const goTo = (stepId: string) => {
    const i = flow.steps.findIndex((x) => x.id === stepId);
    setHist([...hist, i < 0 ? flow.steps.length - 1 : i]);
    setHelp(false);
  };
  const next = () => (st.go ? goTo(st.go) : (setHist([...hist, Math.min(idx + 1, flow.steps.length - 1)]), setHelp(false)));
  const back = () => {
    setHist(hist.length > 1 ? hist.slice(0, -1) : hist);
    setHelp(false);
  };
  return (
    <Shell title={flow.title} lead={st.final ? RESCUE.finished : fill(RESCUE.stepN, { n: hist.length })}>
      <Card className="grid gap-3 p-5">
        <p ref={heading} tabIndex={-1} className="m-0 text-2xl font-bold leading-snug" aria-live="polite">
          {st.text}
        </p>
        {st.detail ? <p className="m-0 text-muted-ink">{st.detail}</p> : null}
        {st.list ? (
          <ul className="m-0 grid gap-1 pl-5">
            {st.list.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : null}
        {help && st.help ? (
          <p className="m-0 flex items-start gap-2 rounded-control bg-blue p-3" role="status">
            <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            <span>{st.help}</span>
          </p>
        ) : null}
        {st.action ? (
          <ButtonLink kind="secondary" href={st.action.href} className="justify-self-start">
            {st.action.label}
          </ButtonLink>
        ) : null}
      </Card>
      <div className="mt-6 grid gap-3">
        {st.options ? (
          st.options.map((o) => (
            <Button key={o.go} kind="primary" block onClick={() => goTo(o.go)}>
              {o.label}
            </Button>
          ))
        ) : st.final ? (
          <>
            <ButtonLink kind="primary" href="/home/rescue" block>
              <Check aria-hidden="true" className="size-5" />
              {RESCUE.done}
            </ButtonLink>
            <ButtonLink kind="secondary" href="/home" block>
              {RESCUE.home}
            </ButtonLink>
          </>
        ) : (
          <Button kind="primary" block onClick={next}>
            <Check aria-hidden="true" className="size-5" />
            {RESCUE.done}
          </Button>
        )}
        {!st.final ? (
          <div className="flex flex-wrap gap-3">
            {st.help ? (
              <Button kind="secondary" aria-pressed={help} onClick={() => setHelp(!help)}>
                {help ? RESCUE.hideHelp : RESCUE.helpMe}
              </Button>
            ) : null}
            {hist.length > 1 ? (
              <Button kind="secondary" onClick={back}>
                {RESCUE.goBack}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

/** /home/rescue/over */
export function Overwhelmed() {
  return (
    <Shell title={RESCUE.overTitle} lead={RESCUE.overLead}>
      <div className="grid gap-3">
        <Option href="/home/rescue/breathe" label={RESCUE.over.breathe} />
        <Option href="/home/rescue/flow/quiet" label={RESCUE.over.quiet} />
        <Option href="/home/rescue/flow/notice" label={RESCUE.over.notice} />
        <Option href="/home/rescue/trusted" label={RESCUE.trusted} />
      </div>
    </Shell>
  );
}

const IN_S = 4;
const OUT_S = 6;
const ROUNDS = 5;

/** /home/rescue/breathe: in for 4, out for 6, five rounds. No movement when reduced motion is on. */
export function Breathe() {
  const { state } = useRumi();
  const [started, setStarted] = useState(false);
  const [tick, setTick] = useState(0);
  const per = IN_S + OUT_S;
  const round = Math.floor(tick / per) + 1;
  const finished = round > ROUNDS;
  const running = started && !finished;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const inPhase = tick % per < IN_S;
  const left = inPhase ? IN_S - (tick % per) : per - (tick % per);
  const still = state.settings.reducedMotion;
  return (
    <Shell title={RESCUE.breatheTitle} lead={RESCUE.breatheLead}>
      <div className="grid justify-items-center gap-4 py-4">
        <div className="grid size-64 place-items-center">
          <div
            aria-hidden="true"
            className={cn(
              "rounded-full bg-sage",
              !still && "transition-transform ease-in-out motion-reduce:transition-none",
              running && inPhase ? "scale-100" : "scale-50",
            )}
            style={{ width: "16rem", height: "16rem", transitionDuration: `${(inPhase ? IN_S : OUT_S) * 1000}ms` }}
          />
        </div>
        <p className="m-0 text-2xl font-bold" aria-live="polite">
          {finished ? RESCUE.breatheDone : running ? `${inPhase ? RESCUE.breatheIn : RESCUE.breatheOut} · ${left}` : ""}
        </p>
        {running ? <p className="m-0 text-muted-ink">{fill(RESCUE.breatheCount, { n: round })}</p> : null}
        <Button
          kind={running ? "secondary" : "primary"}
          onClick={() => {
            if (running) setStarted(false);
            else {
              setTick(0);
              setStarted(true);
            }
          }}
        >
          {running ? RESCUE.breatheStop : finished ? RESCUE.breatheAgain : RESCUE.breatheStart}
        </Button>
      </div>
    </Shell>
  );
}

/** /home/rescue/unsure */
export function Unsure() {
  const id = useId();
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  return (
    <Shell title={RESCUE.unsureTitle} lead={RESCUE.unsureLead}>
      <div className="grid gap-3">
        <Option href="/home/rescue/breathe" label={RESCUE.unsure.breathe} />
        <Option href="/home/rescue/trusted" label={RESCUE.unsure.trusted} />
        <Option href="/home/rescue/say" label={RESCUE.unsure.talk} />
        <Button kind="secondary" block aria-expanded={writing} onClick={() => setWriting(!writing)}>
          {RESCUE.unsure.write}
        </Button>
      </div>
      {writing ? (
        <div className="mt-4 grid gap-2">
          <Field id={id} label={RESCUE.writeLabel} hint={RESCUE.writeHint}>
            <textarea className={fieldControlClass} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <p className="m-0 text-muted-ink">{RESCUE.writeNext}</p>
        </div>
      ) : null}
    </Shell>
  );
}

/** /home/rescue/trusted: your trusted contacts with text and call links, and a message idea. */
export function Trusted() {
  const s = useMore();
  const { state } = useRumi();
  const msg = fill(TRUSTED_MESSAGE, { name: state.settings.name || RESCUE.you });
  return (
    <Shell title={RESCUE.trustedTitle} lead={RESCUE.trustedLead}>
      {!s ? (
        <Loading />
      ) : s.contacts.length === 0 ? (
        <div className="grid gap-3">
          <p className="m-0 text-ink">{RESCUE.noContacts}</p>
          <ButtonLink kind="primary" href="/home/contacts" block arrow>
            {RESCUE.addContacts}
          </ButtonLink>
        </div>
      ) : (
        <div className="grid gap-4">
          <Section title={RESCUE.messageIdea} className="mt-0">
            <Card>
              <p className="m-0">{msg}</p>
            </Card>
          </Section>
          {s.contacts.map((c) => (
            <Card key={c.id} className="grid gap-3">
              <p className="m-0 text-lg font-bold">{c.relation ? `${c.name} · ${c.relation}` : c.name}</p>
              <ReachButtons c={c} />
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}

/** /home/rescue/say and /home/rescue/say/who-goal: pick who and what, get words to say or send. */
export function SayIt({ preset }: { preset?: string }) {
  const { state } = useRumi();
  const [presetWho, presetGoal] = (preset ?? "").split("-");
  const startWho = SAY_WHO.some((w) => w.id === presetWho) ? (presetWho ?? "") : "";
  const [who, setWho] = useState(startWho);
  const [goal, setGoal] = useState(startWho && SAY_GOALS[startWho]?.some((g) => g.id === presetGoal) ? (presetGoal ?? "") : "");
  const [place, setPlace] = useState("");
  const [day, setDay] = useState("");
  const ids = { place: useId(), day: useId() };
  const pre = useRef(null as HTMLParagraphElement | null);
  const { message, copy, clear } = useCopy(RESCUE.copied, RESCUE.copyFailed);
  const goals = SAY_GOALS[who] ?? [];
  const template = goal ? SAY_TEMPLATES[goal] : undefined;
  const text = template
    ? fill(template, { name: state.settings.name || RESCUE.you, place: place.trim() || RESCUE.place, day: day.trim() || RESCUE.day })
    : "";
  return (
    <Shell title={RESCUE.sayTitle} lead={RESCUE.sayLead}>
      <div className="grid gap-5">
        <Segmented
          label={RESCUE.whoLegend}
          showLabel
          value={who}
          onValueChange={(v) => {
            setWho(v);
            setGoal("");
            clear();
          }}
          options={SAY_WHO.map((w) => ({ value: w.id, label: w.label }))}
        />
        {goals.length > 0 ? (
          <Segmented
            label={RESCUE.goalLegend}
            showLabel
            value={goal}
            onValueChange={(v) => {
              setGoal(v);
              clear();
            }}
            options={goals.map((g) => ({ value: g.id, label: g.label }))}
          />
        ) : null}
        {template?.includes("{place}") ? (
          <Field id={ids.place} label={RESCUE.placeLabel} hint={RESCUE.placeHint}>
            <input className={fieldControlClass} value={place} maxLength={80} onChange={(e) => setPlace(e.target.value)} />
          </Field>
        ) : null}
        {template?.includes("{day}") ? (
          <Field id={ids.day} label={RESCUE.dateLabel} hint={RESCUE.dateHint}>
            <input className={fieldControlClass} value={day} maxLength={40} onChange={(e) => setDay(e.target.value)} />
          </Field>
        ) : null}
        {text ? (
          <Section title={RESCUE.scriptTitle} className="mt-0">
            <Card className="border-2 border-primary">
              <p ref={pre} className="m-0 text-lg">
                {text}
              </p>
            </Card>
            <Button kind="secondary" className="justify-self-start" onClick={() => copy(text, pre.current)}>
              <Copy aria-hidden="true" className="size-5" />
              {RESCUE.copy}
            </Button>
            <p role="status" className="m-0 min-h-6 text-ink">
              {message}
            </p>
          </Section>
        ) : null}
      </div>
    </Shell>
  );
}
