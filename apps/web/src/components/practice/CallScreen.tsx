"use client";

import { useRouter } from "next/navigation";
import { ArrowUp, ClipboardList, Lightbulb, Mic, MicOff, Pause, Repeat, RotateCcw, Turtle, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useCrisis } from "@/components/CrisisProvider";
import { DoctorAvatar } from "@/components/practice/DoctorAvatar";
import { HelpSheet, type HelpState } from "@/components/practice/HelpSheet";
import { PlanSheet } from "@/components/practice/PlanSheet";
import { useInertShell } from "@/components/practice/useInertShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ArrowLeft } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Sheet } from "@/components/ui/sheet";
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
  /** A note before the practice (for example "Rumi used the first part of this file."). Never sent to the AI or saved in the session. */
  setup?: boolean;
  /** Plan lines covered so far (clinician lines only). */
  covered: string[];
  last?: boolean;
};

const MIN_RATE = 0.7;
const icon = "size-5 shrink-0";
/** The whole visit: the clinician starts with the first line of the plan and works through them. */
const FOCUS: Focus = "whole";
/** The small quick answers under a message, like the suggestions in a chat app. */
const CHIP =
  "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line-strong bg-surface px-4 text-[.95rem] font-bold text-ink transition-colors duration-150 hover:bg-lav disabled:cursor-not-allowed disabled:opacity-60";

function lastIndexOfMe(msgs: Msg[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "me") return i;
  return -1;
}

/**
 * The practice chat: a full-screen layer above the app shell (spec 4.4), laid out like a chat app. The clinician
 * starts with the first line of the plan and the practice goes on in the same chat. It owns its top bar, one history
 * entry, and the Esc rule. While it is up the shell behind it is inert.
 */
export function CallScreen({ plan, note, onFinish }: { plan: VisitPlan; note?: string; onFinish: (session: PracticeSession) => void }) {
  const { state } = useRumi();
  const { show } = useCrisis();
  const router = useRouter();
  const { outputMode, companionName } = state.settings;

  const [msgs, setMsgs] = useState<Msg[]>(() => [
    ...(note ? [{ id: 0, role: "clinician" as const, text: note, setup: true, covered: [] }] : []),
    { id: 1, role: "clinician", text: PRACTICE.greeting, setup: true, covered: [] },
    { id: 2, role: "clinician", text: openingLine(), covered: [] },
  ]);
  const focus = FOCUS;
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
  const nextId = useRef(3);
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

  const setupMsgs = msgs.filter((m) => m.setup);
  const real = msgs.filter((m) => !m.repeated && !m.setup);
  const lastClinician = [...real].reverse().find((m) => m.role === "clinician") ?? msgs[msgs.length - 1];
  const covered = lastClinician.covered;
  const isLast = lastClinician.last === true;
  const hasAnswer = real.some((m) => m.role === "me");
  // Ready-made answers under the box: the next lines of the plan that no answer has covered yet. Tapping one fills the box.
  const starters = isLast ? [] : uncovered(plan, focus, covered).slice(0, 3);
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
    setMsgs([...setupMsgs, ...real, me, reply]);
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
      style={{ "--tabbar-h": "0px" } as CSSProperties}
      className="fixed inset-0 z-[var(--z-call)] flex flex-col bg-bg text-ink"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 pt-[max(.5rem,env(safe-area-inset-top))]">
        <Button kind="secondary" disabled={leaving} aria-label={fill(PRACTICE.backTo, { title: PAGES["/practice"].title })} onClick={() => setLeaveOpen(true)}>
          <ArrowLeft aria-hidden="true" className="size-5" />
          {NAV.back}
        </Button>
        <p className="m-0 min-w-0 truncate text-center font-bold">{PRACTICE.callTitle}</p>
        <Button kind="secondary" onClick={() => setEndOpen(true)} disabled={leaving}>
          {PRACTICE.endPractice}
        </Button>
      </header>

      <h1 ref={title} tabIndex={-1} className="sr-only">
        {PRACTICE.callTitle}
      </h1>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-6">
          <div role="log" aria-live="polite" aria-label={PRACTICE.logLabel}>
            <ol className="m-0 grid list-none gap-6 p-0">
              {msgs.map((m) => (
                <li key={m.id} data-role={m.role} className={cn("flex items-start gap-3", m.role === "me" && "justify-end")}>
                  {m.role === "clinician" ? <DoctorAvatar speaking={m.id === lastClinician.id && (busy || speaking)} className="mt-0.5 size-9" /> : null}
                  <div className={cn("min-w-0", m.role === "me" ? "max-w-[85%] rounded-3xl bg-primary-soft px-4 py-2.5" : "flex-1 py-1")}>
                    <span className="sr-only">
                      {m.role === "me" ? PRACTICE.you : PRACTICE.clinician}
                      {m.repeated ? ` ${PRACTICE.repeated}` : ""}
                    </span>
                    <p className="m-0 max-w-none text-[1.05rem] leading-relaxed">{m.text}</p>
                  </div>
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
          <div ref={end} />
        </div>
      </div>

      <footer className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <form onSubmit={onSubmit} className="mx-auto grid w-full max-w-3xl gap-2">
          <div role="group" aria-label={PRACTICE.toolbarLabel} className="flex flex-wrap items-start gap-2">
            <button type="button" className={CHIP} onClick={() => void openHelp()} disabled={toolbarBusy || helpBusy}>
              <Lightbulb aria-hidden="true" className={icon} />
              {PRACTICE.help}
            </button>
            <button type="button" className={CHIP} onClick={repeat} disabled={toolbarBusy}>
              <Repeat aria-hidden="true" className={icon} />
              {PRACTICE.repeat}
            </button>
            {speaking ? (
              <button type="button" className={CHIP} onClick={stopReading}>
                <VolumeX aria-hidden="true" className={icon} />
                {PRACTICE.stopReading}
              </button>
            ) : null}
            <details className="group">
              <summary className={`${CHIP} list-none [&::-webkit-details-marker]:hidden`}>{PRACTICE.more}</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={CHIP} onClick={() => setPlanOpen(true)} disabled={leaving}>
                  <ClipboardList aria-hidden="true" className={icon} />
                  {PRACTICE.showPlan}
                </button>
                <button type="button" className={CHIP} onClick={pause} disabled={leaving}>
                  <Pause aria-hidden="true" className={icon} />
                  {PRACTICE.pause}
                </button>
                {readAloud ? (
                  <button type="button" className={CHIP} onClick={slowDown} disabled={toolbarBusy || rate <= MIN_RATE}>
                    <Turtle aria-hidden="true" className={icon} />
                    {PRACTICE.slowDown}
                  </button>
                ) : null}
                {hasAnswer ? (
                  <button type="button" className={CHIP} onClick={tryThatAgain} disabled={toolbarBusy}>
                    <RotateCcw aria-hidden="true" className={icon} />
                    {PRACTICE.tryAgain}
                  </button>
                ) : null}
              </div>
            </details>
          </div>

          {!isLast && starters.length > 0 && text.trim() === "" ? (
            <div role="group" aria-label={PRACTICE.startersLabel} className="flex flex-wrap gap-2">
              {starters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={CHIP}
                  disabled={paused || leaving || busy}
                  onClick={() => {
                    setText(item.text);
                    input.current?.focus();
                  }}
                >
                  {item.text}
                </button>
              ))}
            </div>
          ) : null}

          {isLast ? (
            <Button kind={paused ? "secondary" : "primary"} type="submit" arrow block disabled={paused || leaving} loading={busy}>
              {PRACTICE.seeSummary}
            </Button>
          ) : (
            <div className="flex items-end gap-1 rounded-[28px] border-2 border-line-strong bg-surface p-2 pl-5 [box-shadow:var(--shadow)] focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus">
              <label htmlFor="practice-answer" className="sr-only">
                {PRACTICE.answerLabel}
              </label>
              <textarea
                id="practice-answer"
                ref={input}
                rows={1}
                placeholder={PRACTICE.placeholder}
                className="max-h-48 min-h-12 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-3 text-ink outline-none placeholder:text-muted-ink"
                value={text}
                disabled={paused || leaving}
                onChange={(e) => {
                  setText(e.target.value);
                  if (status === PRACTICE.blank) setStatus("");
                }}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter adds a line, and a key that only finishes a word (IME) is left alone.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (!paused && !leaving && !busy) void send();
                  }
                }}
              />
              {canListen() ? (
                <button
                  type="button"
                  onClick={mic}
                  disabled={paused || leaving}
                  aria-pressed={listening}
                  className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border-2 border-line-strong bg-surface text-ink hover:bg-lav disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {listening ? <MicOff aria-hidden="true" className={icon} /> : <Mic aria-hidden="true" className={icon} />}
                  <span className="sr-only">{listening ? PRACTICE.micStop : PRACTICE.micStart}</span>
                </button>
              ) : null}
              <button
                type="submit"
                data-kind="primary"
                disabled={paused || leaving || busy}
                aria-busy={busy || undefined}
                className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-ink hover:bg-[color-mix(in_srgb,var(--primary),#000_8%)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <ArrowUp aria-hidden="true" className={icon} />
                <span className="sr-only">{PRACTICE.send}</span>
              </button>
            </div>
          )}
          <p role="status" className="note m-0 min-h-6 text-center">
            {line}
          </p>
          <p className="note m-0 text-center">{PRACTICE.banner}</p>
        </form>
      </footer>

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
