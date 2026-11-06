"use client";

import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Lightbulb,
  Mic,
  MicOff,
  Pause,
  Repeat,
  RotateCcw,
  Square,
  Turtle,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useCrisis } from "@/components/CrisisProvider";
import { UrgentHelpButton } from "@/components/nav/UrgentHelpButton";
import { DoctorAvatar } from "@/components/practice/DoctorAvatar";
import { HelpSheet, type HelpState } from "@/components/practice/HelpSheet";
import { PlanSheet } from "@/components/practice/PlanSheet";
import type { Ready } from "@/components/practice/Readiness";
import { useInertShell } from "@/components/practice/useInertShell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { fieldControlClass } from "@/components/ui/field";
import { ArrowLeft } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Sheet } from "@/components/ui/sheet";
import { StickyActions } from "@/components/ui/sticky-actions";
import { NAV } from "@/content/nav";
import { PRACTICE } from "@/content/practice";
import { isCrisis } from "@/lib/crisis";
import { openingLine, requestHelp, requestTurn, uncovered, type HelpLevelShown } from "@/features/adapters/practice";
import { startLevelFor } from "@/features/adapters/startLevelFor";
import type { Focus, HelpLevel, PracticeSession, VisitPlan } from "@/features/shared/types";
import { fill } from "@/lib/fill";
import { PAGES } from "@/lib/pages";
import { popMarker, pushMarker } from "@/lib/practiceHistory";
import { canListen, canSpeak, listen, speak, stopSpeaking } from "@/lib/practiceSpeech";
import { useRumi } from "@/lib/rumiActive";

type Msg = {
  id: number;
  role: "clinician" | "me";
  text: string;
  usedHelp?: boolean;
  repeated?: boolean;
  /** Plan lines covered so far (clinician lines only). */
  covered: string[];
  last?: boolean;
};

const MIN_RATE = 0.7;
const icon = "size-5 shrink-0";

function lastIndexOfMe(msgs: Msg[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "me") return i;
  return -1;
}

/**
 * The practice call: a full-screen layer above the app shell (spec 4.4). It owns its top bar, one history entry,
 * and the Esc rule. While it is up the shell behind it is inert.
 */
export function CallScreen({
  plan,
  focus,
  readyBefore,
  onFinish,
}: {
  plan: VisitPlan;
  focus: Focus;
  readyBefore?: Ready;
  onFinish: (session: PracticeSession) => void;
}) {
  const { state } = useRumi();
  const { show } = useCrisis();
  const router = useRouter();
  const { outputMode, companionName } = state.settings;

  const [msgs, setMsgs] = useState<Msg[]>(() => [{ id: 0, role: "clinician", text: openingLine(), covered: [] }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null as "turn" | "help" | null);
  const [status, setStatus] = useState("");
  const [paused, setPaused] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [help, setHelp] = useState(null as HelpState | null);
  const [helpBusy, setHelpBusy] = useState(false);
  const [helpPending, setHelpPending] = useState(false);
  const [helpCount, setHelpCount] = useState(0);
  const [helpLevels, setHelpLevels] = useState({} as Record<string, HelpLevel>);
  const [rate, setRate] = useState(state.settings.speechRate);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [started] = useState(() => Date.now());

  const layer = useRef(null as HTMLDivElement | null);
  const title = useRef(null as HTMLHeadingElement | null);
  const input = useRef(null as HTMLTextAreaElement | null);
  const end = useRef(null as HTMLDivElement | null);
  const nextId = useRef(1);
  const stopListening = useRef(() => {});
  const detach = useRef(() => {});

  useInertShell(layer);

  // The single history entry: browser Back or a swipe-back lands here and opens the leave sheet.
  useEffect(() => {
    pushMarker();
    const onPop = () => setLeaveOpen(true);
    window.addEventListener("popstate", onPop);
    detach.current = () => window.removeEventListener("popstate", onPop);
    const listening = stopListening;
    const detached = detach;
    return () => {
      detached.current();
      listening.current();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    title.current?.focus();
  }, []);

  // Keep the newest line in view.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  const real = msgs.filter((m) => !m.repeated);
  const lastClinician = [...real].reverse().find((m) => m.role === "clinician") ?? msgs[0];
  const covered = lastClinician.covered;
  const isLast = lastClinician.last === true;
  const hasAnswer = real.some((m) => m.role === "me");
  const layerOpen = leaveOpen || endOpen || planOpen || paused || help !== null;
  const readAloud = outputMode !== "read" && canSpeak();

  const say = (line: string) => {
    if (!readAloud) return;
    setSpeaking(true);
    speak(line, rate, () => setSpeaking(false));
  };
  const stopReading = () => {
    stopSpeaking();
    setSpeaking(false);
  };

  const buildSession = (): PracticeSession => ({
    id: `practice-${started}`,
    planId: plan.id,
    startedAt: new Date(started).toISOString(),
    focus,
    readyBefore,
    turns: real.map(({ role, text: t, usedHelp }) => (usedHelp ? { role, text: t, usedHelp } : { role, text: t })),
    coveredItemIds: covered,
    helpCount,
    helpLevelUsed: helpLevels,
  });

  // Every in-app exit: stop the listener, take the history entry off, wait for its popstate, then go on.
  const exit = (go: () => void) => {
    if (leaving) return;
    setLeaving(true);
    stopReading();
    stopListening.current();
    detach.current();
    popMarker(go);
  };
  const leave = () => exit(() => router.push("/home"));
  const finish = () => {
    setEndOpen(false);
    exit(() => onFinish(buildSession()));
  };

  const keepPracticing = () => {
    setLeaveOpen(false);
    pushMarker();
  };

  const send = async () => {
    const answer = text.trim();
    if (!answer) {
      setStatus(PRACTICE.blank);
      return;
    }
    if (isCrisis(answer)) {
      show();
      return;
    }
    stopReading();
    setBusy(true);
    setFailed(null);
    setStatus("");
    const me: Msg = { id: nextId.current++, role: "me", text: answer, usedHelp: helpPending || undefined, covered: [] };
    const turns = [...real, me].map(({ role, text: t, usedHelp }) => ({ role, text: t, ...(usedHelp ? { usedHelp } : {}) }));
    const res = await requestTurn({ plan, focus, turns, companionName });
    setBusy(false);
    if (!res.ok) {
      if ("crisis" in res) show();
      else setFailed("turn");
      return;
    }
    const reply: Msg = {
      id: nextId.current++,
      role: "clinician",
      text: res.data.clinicianSay,
      covered: [...new Set([...covered, ...res.data.coveredItemIds])],
      last: res.data.isLastTurn,
    };
    setMsgs([...real, me, reply]);
    setText("");
    setHelpPending(false);
    say(reply.text);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isLast) finish();
    else void send();
  };

  const repeat = () => {
    setMsgs([...msgs, { ...lastClinician, id: nextId.current++, repeated: true }]);
    say(lastClinician.text);
  };

  const slowDown = () => {
    setRate(Math.max(MIN_RATE, Math.round((rate - 0.15) * 100) / 100));
    setStatus(PRACTICE.slowDownDone);
  };

  const tryThatAgain = () => {
    const i = lastIndexOfMe(msgs);
    if (i < 0) return;
    stopReading();
    setText(msgs[i].text);
    setHelpPending(msgs[i].usedHelp === true);
    setMsgs(msgs.slice(0, i));
    setFailed(null);
    setStatus("");
    requestAnimationFrame(() => input.current?.focus());
  };

  const pause = () => {
    stopReading();
    stopListening.current();
    setPaused(true);
  };

  const mic = () => {
    if (listening) {
      stopListening.current();
      return;
    }
    stopListening.current = listen(
      (t) => setText((prev) => (prev ? `${prev} ${t}` : t)),
      () => setListening(false),
    );
    setListening(true);
  };

  const record = (id: string, level: HelpLevelShown) =>
    setHelpLevels((prev) => ({ ...prev, [id]: Math.max(prev[id] ?? 0, level) as HelpLevel }));

  const openHelp = async () => {
    const item = uncovered(plan, focus, covered)[0] ?? null;
    if (!item) {
      setHelp({ item: null, level: 1 });
      return;
    }
    const level = Math.max(1, startLevelFor(state, item.kind)) as HelpLevelShown;
    setHelpBusy(true);
    setFailed(null);
    const res = await requestHelp({ plan, item, level, clinicianQuestion: lastClinician.text, companionName });
    setHelpBusy(false);
    if (!res.ok) {
      if ("crisis" in res) show();
      else setFailed("help");
      return;
    }
    setHelp({ item, level });
    setHelpCount((n) => n + 1);
    record(item.id, level);
  };

  const moreHelp = () => {
    if (!help?.item || help.level >= 3) return;
    const level = (help.level + 1) as HelpLevelShown;
    setHelp({ item: help.item, level });
    record(help.item.id, level);
  };

  const useHelp = (t: string) => {
    setText(t);
    setHelpPending(true);
    setStatus("");
    setHelp(null);
  };

  // Esc closes the open layer (Radix does that and marks the event handled); with none open it opens the leave sheet.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented || leaving || layerOpen) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    setLeaveOpen(true);
  };

  const line = busy ? PRACTICE.thinking : status;
  const toolbarBusy = leaving || busy;

  return createPortal(
    <div
      ref={layer}
      data-call-screen
      role="region"
      aria-label={PRACTICE.callRegion}
      onKeyDown={onKeyDown}
      // No tab bar here, so the sticky Send sits at the bottom edge.
      style={{ "--tabbar-h": "0px", scrollPaddingBottom: "calc(var(--sticky-h) + 1rem)" } as CSSProperties}
      className="fixed inset-0 z-[var(--z-call)] overflow-y-auto bg-bg text-ink"
    >
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-bg py-2 pt-[max(.5rem,env(safe-area-inset-top))]">
          <Button
            kind="secondary"
            disabled={leaving}
            aria-label={fill(PRACTICE.backTo, { title: PAGES["/practice"].title })}
            onClick={() => setLeaveOpen(true)}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
            {NAV.back}
          </Button>
          <UrgentHelpButton chrome />
        </header>

        <h1 ref={title} tabIndex={-1} className="sr-only">
          {PRACTICE.callTitle}
        </h1>

        <div className="grid flex-1 content-start gap-4 py-4">
          <Banner>{PRACTICE.banner}</Banner>
          <div className="flex items-center gap-4">
            <DoctorAvatar speaking={busy || speaking} />
          </div>

          <div role="log" aria-live="polite" aria-label={PRACTICE.logLabel}>
            <ol className="m-0 grid list-none gap-3 p-0">
              {msgs.map((m) => (
                <li
                  key={m.id}
                  data-role={m.role}
                  className="grid gap-0.5 rounded-card border border-line-strong bg-surface p-3 data-[role=me]:bg-primary-soft"
                >
                  <span className="text-sm font-bold text-muted-ink">
                    {m.role === "me" ? PRACTICE.you : PRACTICE.clinician}
                    {m.repeated ? ` ${PRACTICE.repeated}` : ""}
                  </span>
                  <span>{m.text}</span>
                </li>
              ))}
            </ol>
          </div>

          {failed ? (
            <Notice tone="warn" title={PRACTICE.failedTitle}>
              <p>{failed === "turn" ? PRACTICE.failed : PRACTICE.failedHelp}</p>
              <Button kind="secondary" onClick={() => (failed === "turn" ? void send() : void openHelp())}>
                {PRACTICE.retry}
              </Button>
            </Notice>
          ) : null}

          <div role="group" aria-label={PRACTICE.toolbarLabel} className="flex flex-wrap gap-x-1 gap-y-1">
            <Button kind="tertiary" onClick={pause} disabled={leaving}>
              <Pause aria-hidden="true" className={icon} />
              {PRACTICE.pause}
            </Button>
            <Button kind="tertiary" onClick={repeat} disabled={toolbarBusy}>
              <Repeat aria-hidden="true" className={icon} />
              {PRACTICE.repeat}
            </Button>
            {readAloud ? (
              <Button kind="tertiary" onClick={slowDown} disabled={toolbarBusy || rate <= MIN_RATE}>
                <Turtle aria-hidden="true" className={icon} />
                {PRACTICE.slowDown}
              </Button>
            ) : null}
            {speaking ? (
              <Button kind="tertiary" onClick={stopReading}>
                <VolumeX aria-hidden="true" className={icon} />
                {PRACTICE.stopReading}
              </Button>
            ) : null}
            <Button kind="tertiary" onClick={() => void openHelp()} loading={helpBusy} disabled={toolbarBusy}>
              <Lightbulb aria-hidden="true" className={icon} />
              {PRACTICE.help}
            </Button>
            <Button kind="tertiary" onClick={() => setPlanOpen(true)} disabled={leaving}>
              <ClipboardList aria-hidden="true" className={icon} />
              {PRACTICE.showPlan}
            </Button>
            {hasAnswer ? (
              <Button kind="tertiary" onClick={tryThatAgain} disabled={toolbarBusy}>
                <RotateCcw aria-hidden="true" className={icon} />
                {PRACTICE.tryAgain}
              </Button>
            ) : null}
            <Button kind="tertiary" onClick={() => setEndOpen(true)} disabled={leaving}>
              <Square aria-hidden="true" className={icon} />
              {PRACTICE.endPractice}
            </Button>
          </div>
          <div ref={end} />
        </div>

        <div className="lg:sticky lg:bottom-0">
          <form onSubmit={onSubmit}>
            <StickyActions>
              <div className="grid gap-2">
                {isLast ? null : (
                  <>
                    <label htmlFor="practice-answer" className="font-bold">
                      {PRACTICE.answerLabel}
                    </label>
                    <div className="flex items-start gap-2">
                      <textarea
                        id="practice-answer"
                        ref={input}
                        rows={2}
                        className={`${fieldControlClass} min-w-0 flex-1`}
                        value={text}
                        disabled={paused || leaving}
                        onChange={(e) => {
                          setText(e.target.value);
                          if (status === PRACTICE.blank) setStatus("");
                        }}
                      />
                      {canListen() ? (
                        <Button kind="secondary" onClick={mic} disabled={paused || leaving} aria-pressed={listening}>
                          {listening ? <MicOff aria-hidden="true" className={icon} /> : <Mic aria-hidden="true" className={icon} />}
                          {listening ? PRACTICE.micStop : PRACTICE.micStart}
                        </Button>
                      ) : null}
                    </div>
                  </>
                )}
                <p role="status" className="note m-0 min-h-6">
                  {line}
                </p>
                <Button
                  kind={paused ? "secondary" : "primary"}
                  type="submit"
                  arrow
                  block
                  disabled={paused || leaving}
                  loading={busy}
                >
                  {isLast ? PRACTICE.seeSummary : PRACTICE.send}
                </Button>
              </div>
            </StickyActions>
          </form>
        </div>
      </div>

      <Sheet open={leaveOpen} onOpenChange={(o) => (o ? setLeaveOpen(true) : keepPracticing())} title={PRACTICE.leaveTitle}>
        <p className="m-0">{PRACTICE.leaveText}</p>
        <Button kind="primary" block onClick={keepPracticing}>
          {PRACTICE.keep}
        </Button>
        <Button kind="secondary" block onClick={leave} disabled={leaving}>
          {PRACTICE.leave}
        </Button>
      </Sheet>

      <Sheet open={endOpen} onOpenChange={setEndOpen} title={PRACTICE.endTitle}>
        <p className="m-0">{PRACTICE.endText}</p>
        <Button kind="primary" block onClick={finish} disabled={leaving}>
          {PRACTICE.endNow}
        </Button>
        <Button kind="secondary" block onClick={() => setEndOpen(false)}>
          {PRACTICE.keep}
        </Button>
      </Sheet>

      <Sheet open={paused} onOpenChange={setPaused} title={PRACTICE.pausedTitle}>
        <p className="m-0">{PRACTICE.pausedText}</p>
        <Button kind="primary" block onClick={() => setPaused(false)}>
          {PRACTICE.resume}
        </Button>
      </Sheet>

      <PlanSheet open={planOpen} onOpenChange={setPlanOpen} plan={plan} />
      <HelpSheet help={help} onOpenChange={(o) => !o && setHelp(null)} onMore={moreHelp} onUse={useHelp} />
    </div>,
    document.body,
  );
}
