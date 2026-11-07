"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useCrisis } from "@/components/CrisisProvider";
import { MicButton } from "@/components/getReady/MicButton";
import { Scene } from "@/components/getReady/Scene";
import { PlanList, type Removed } from "@/components/getReady/PlanList";
import { Mascot } from "@/components/marketing/Mascot";
import { Button, ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/notice";
import { ArrowUp } from "@/components/ui/icons";
import { Screen } from "@/components/ui/screen";
import { StickyActions } from "@/components/ui/sticky-actions";
import { GET_READY } from "@/content/getReady";
import { chatCall, newSupportCard, planCall, splitIntoPlanLines } from "@/features/adapters/getReadyKit";
import { LIMITS } from "@/features/shared/constants";
import { MAX_CHATS, MAX_CHAT_MESSAGES } from "@/lib/storage-schema";
import { isCrisis } from "@/lib/crisis";
import type { PlanItem, RumiState, VisitPlan } from "@/features/shared/types";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

/** Suggested lines always start switched off, whatever the reply says. */
const offUntilChosen = (plan: VisitPlan): VisitPlan => ({
  ...plan,
  items: plan.items.map((i) => (i.source === "suggested" ? { ...i, enabled: false } : i)),
});

type Msg = { role: "me" | "rumi"; text: string };
const GREETING: Msg = { role: "rumi", text: GET_READY.greeting };
const chipClass = "min-h-10 rounded-full border border-line bg-surface px-4 text-[.95rem] font-bold text-ink hover:bg-lav";

/** The conversation, like a chat: Rumi on the left, the person on the right. New lines scroll into view. */
function Thread({ messages, working, workingText }: { messages: Msg[]; working: boolean; workingText: string }) {
  const end = useRef(null as HTMLLIElement | null);
  useEffect(() => {
    if (messages.length > 1 || working) end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, working]);
  return (
    <ol role="log" aria-live="polite" aria-label={GET_READY.threadLabel} className="m-0 grid list-none gap-3 p-0 text-left">
      {messages.map((m, i) => (
        <li key={i} className={cn("flex items-start gap-2", m.role === "me" && "justify-end")}>
          {m.role === "rumi" ? (
            <span aria-hidden="true" className="mt-1 shrink-0">
              <Mascot size={30} />
            </span>
          ) : null}
          <p
            className={cn(
              "m-0 max-w-[85%] rounded-[22px] px-4 py-3",
              m.role === "me" ? "bg-primary text-primary-ink" : "border border-line bg-surface text-ink",
            )}
          >
            {m.text}
          </p>
        </li>
      ))}
      {working ? (
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 shrink-0">
            <Mascot size={30} />
          </span>
          <p className="m-0 rounded-[22px] border border-line bg-surface px-4 py-3 text-muted-ink">{workingText}</p>
        </li>
      ) : null}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}

function GetReadyBody() {
  const { state, update } = useRumi();
  const { show } = useCrisis();
  const uid = useId();
  const box = useRef(null as HTMLTextAreaElement | null);
  const lastRun = useRef(null as { text: string; msgs: Msg[] } | null);
  const [rawText, setRawText] = useState("");
  const [blank, setBlank] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null as string | null);
  const [degraded, setDegraded] = useState(false);
  const [draft, setDraft] = useState(null as VisitPlan | null);
  const [removed, setRemoved] = useState(null as Removed | null);
  const [message, setMessage] = useState("");
  const [micNote, setMicNote] = useState("");
  const [thread, setThread] = useState([GREETING] as Msg[]);
  // What the person has said (one entry per message), the questions Rumi asked, and how many the person skipped.
  const [words, setWords] = useState([] as string[]);
  const [qs, setQs] = useState([] as string[]);
  const [skipped, setSkipped] = useState(0);
  const [chatBusy, setChatBusy] = useState(false);
  // True while a question is waiting for an answer (shows Skip and "Make my plan now").
  const [open, setOpen] = useState(false);

  // The box grows with its text (up to its max height), and shrinks again when text is removed.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [rawText]);

  const plan = draft ?? state.plan;
  const card = state.supportCard;
  const phase = !plan ? "empty" : draft || !card ? "plan" : "saved";
  const started = thread.length > 1;

  /** The conversation is kept so the person can come back to it (Get ready chat history). */
  const saveChat = (messages: Msg[]) => {
    const now = new Date().toISOString();
    update((d: RumiState) => {
      const kept = messages.slice(-MAX_CHAT_MESSAGES);
      const t = { id: `g-${Date.now().toString(36)}`, kind: "get-ready" as const, createdAt: now, updatedAt: now, messages: kept };
      d.chats = [...(d.chats ?? []), t].slice(-MAX_CHATS);
    });
  };

  const runPlan = async (text: string, msgs: Msg[]) => {
    lastRun.current = { text, msgs };
    setLoading(true);
    let r = await planCall(text.slice(0, LIMITS.rawTextMax), state.settings.companionName);
    // The built-in fallback only repeats the person's own sentences. Ask the AI once more before settling for it.
    if (r.ok && r.data.degraded) r = await planCall(text.slice(0, LIMITS.rawTextMax), state.settings.companionName);
    setLoading(false);
    if (r.ok) {
      const done: Msg[] = [...msgs, { role: "rumi", text: GET_READY.planReady }];
      setThread(done);
      setDraft(offUntilChosen(r.data.plan));
      setDegraded(r.data.degraded === true);
      saveChat(done);
    } else if ("crisis" in r) {
      show();
    } else {
      setError(r.error.message);
    }
  };

  /** One turn of the conversation: the AI hears everything said so far and answers softly, then asks what matters most next. */
  const turn = async (w: string[], msgs: Msg[], asked: string[], sk: number) => {
    setOpen(false);
    setChatBusy(true);
    const r = await chatCall(w.join("\n"), asked, sk, state.settings.companionName);
    setChatBusy(false);
    if (!r.ok) {
      if ("crisis" in r) return show();
      // The helper could not be reached: make the plan from what was said, so the person is never stuck.
      const done: Msg[] = [...msgs, { role: "rumi", text: GET_READY.makingPlan }];
      setThread(done);
      return runPlan(w.join("\n"), done);
    }
    const said: Msg[] = [...msgs, { role: "rumi", text: r.data.reply }];
    if (r.data.ready || !r.data.question) {
      setThread(said);
      return runPlan(w.join("\n"), said);
    }
    const asking: Msg[] = [...said, { role: "rumi", text: r.data.question }];
    setQs([...asked, r.data.question]);
    setThread(asking);
    setOpen(true);
  };

  const make = async (e?: FormEvent) => {
    e?.preventDefault();
    setMessage("");
    setError(null);
    const text = rawText.trim();
    if (!text) {
      setBlank(true);
      box.current?.focus();
      return;
    }
    setBlank(false);
    if (isCrisis(text)) return show();
    setRawText("");
    const mine: Msg[] = [...thread, { role: "me", text }];
    const w = [...words, text];
    setThread(mine);
    setWords(w);
    await turn(w, mine, qs, skipped);
  };

  const skip = () => {
    const sk = skipped + 1;
    setSkipped(sk);
    void turn(words, thread, qs, sk);
  };

  const planNow = () => {
    const msgs: Msg[] = [...thread, { role: "rumi", text: GET_READY.makingPlan }];
    setOpen(false);
    setThread(msgs);
    void runPlan(words.join("\n"), msgs);
  };

  // After each question the cursor goes back to the box.
  useEffect(() => {
    if (open && !chatBusy) box.current?.focus();
  }, [open, chatBusy, thread.length]);

  /** Any change to the plan lines. Works on the draft before "Looks right" and on the saved plan after it. */
  const editItems = (fn: (items: PlanItem[]) => PlanItem[], keepRemoved = false) => {
    setMessage("");
    if (!keepRemoved) setRemoved(null);
    if (draft) return setDraft({ ...draft, items: fn(draft.items) });
    update((d: RumiState) => {
      if (!d.plan) return;
      d.plan.items = fn(d.plan.items);
      if (d.supportCard) {
        const live = new Set(d.plan.items.filter((i) => i.enabled && i.kind === "question").map((i) => i.id));
        d.supportCard.topQuestionIds = d.supportCard.topQuestionIds.filter((id) => live.has(id));
      }
    });
  };

  const remove = (id: string) => {
    const index = plan?.items.findIndex((i) => i.id === id) ?? -1;
    const item = plan?.items[index];
    if (!item) return;
    editItems((items) => items.filter((i) => i.id !== id));
    setRemoved({ item, index });
  };
  const undo = () => {
    if (!removed) return;
    editItems((items) => {
      const at = Math.min(removed.index, items.length);
      return [...items.slice(0, at), removed.item, ...items.slice(at)];
    }, true);
    setRemoved(null);
  };
  const addLine = (text: string) => {
    const lines = splitIntoPlanLines(text);
    if (lines.length === 0) return;
    const stamp = Date.now().toString(36);
    editItems((items) => [
      ...items,
      ...lines.map((l, n) => ({ id: `u-${stamp}-${n}`, text: l.text, kind: l.kind, source: "user" as const, enabled: true })),
    ]);
  };

  const confirm = () => {
    if (!plan) return;
    update((d: RumiState) => {
      d.plan = plan;
      d.supportCard = newSupportCard(plan, d.persona);
    });
    setDraft(null);
    setRemoved(null);
    setMessage(GET_READY.saved);
  };

  return (
    <>
      {phase === "empty" ? (
        <div data-scene data-phase="empty" className={cn("mx-auto mt-6 flex w-full max-w-3xl flex-1 flex-col gap-4", !started && "justify-center")}>
          <Thread messages={thread} working={loading || chatBusy} workingText={loading ? GET_READY.loading : GET_READY.thinking} />
          {open ? (
            <div className="flex flex-wrap gap-2 pl-10">
              <Button kind="tertiary" onClick={skip}>
                {GET_READY.skip}
              </Button>
              <Button kind="tertiary" onClick={planNow}>
                {GET_READY.planNow}
              </Button>
            </div>
          ) : !started ? (
            <div className="flex flex-wrap gap-2 pl-10">
              {GET_READY.starters.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => {
                    setRawText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
                    setBlank(false);
                    box.current?.focus();
                  }}
                  className={chipClass}
                >
                  {text}
                </button>
              ))}
            </div>
          ) : null}
          {error !== null ? (
            <Notice tone="warn" title={GET_READY.errorTitle}>
              {error ? <p>{error}</p> : null}
              <Button
                kind="secondary"
                className="mt-2"
                onClick={() => {
                  setError(null);
                  if (lastRun.current) void runPlan(lastRun.current.text, lastRun.current.msgs);
                }}
              >
                {GET_READY.tryAgain}
              </Button>
            </Notice>
          ) : null}
          <form
            onSubmit={make}
            className={cn("sticky bottom-[calc(var(--tabbar-h)+1rem)] z-10 mt-2 grid gap-2 lg:bottom-4", started && "mt-auto")}
          >
            <div className="flex items-end gap-1 rounded-[28px] border-2 border-line-strong bg-surface p-2 pl-5 shadow-[var(--shadow)] focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus">
              <label htmlFor={`${uid}-box`} className="sr-only">
                {GET_READY.boxLabel}
              </label>
              <textarea
                ref={box}
                id={`${uid}-box`}
                rows={1}
                maxLength={2000}
                placeholder={open ? GET_READY.answerHint : GET_READY.boxHint}
                aria-invalid={blank}
                aria-describedby={blank ? `${uid}-blank` : undefined}
                disabled={loading || chatBusy}
                className="max-h-48 min-h-12 flex-1 resize-none overflow-y-auto bg-transparent py-3 text-ink outline-none placeholder:text-muted-ink"
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value);
                  setBlank(false);
                }}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter adds a line. Enter that confirms an IME word must not send.
                  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  void make();
                }}
              />
              <MicButton
                compact
                onNote={setMicNote}
                onText={(t) => setRawText((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))}
              />
              <button
                type="submit"
                data-kind="primary"
                disabled={loading || chatBusy}
                aria-busy={loading || chatBusy || undefined}
                className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-ink hover:bg-[color-mix(in_srgb,var(--primary),#000_8%)] disabled:cursor-progress disabled:opacity-70"
              >
                <ArrowUp aria-hidden="true" className="size-5" />
                <span className="sr-only">{GET_READY.makePlan}</span>
              </button>
            </div>
            {blank ? (
              <p id={`${uid}-blank`} className="m-0 font-bold text-danger">
                {GET_READY.blank}
              </p>
            ) : null}
            {micNote ? (
              <p role="status" className="m-0 text-ink">
                {micNote}
              </p>
            ) : null}
          </form>
        </div>
      ) : (
        <div data-scene={phase === "plan" ? "" : undefined} data-phase={phase} className="mx-auto grid w-full max-w-3xl gap-5 text-left">
          {phase === "plan" && started ? <Thread messages={thread} working={false} workingText="" /> : null}
          {degraded ? <Notice tone="info">{GET_READY.degraded}</Notice> : null}
          <section aria-labelledby={`${uid}-plan`} className="grid gap-4">
            <div>
              <h2 id={`${uid}-plan`}>{GET_READY.planHeading}</h2>
              <p className="m-0 text-muted-ink">{GET_READY.planLead}</p>
            </div>
            <PlanList
              items={plan?.items ?? []}
              removed={removed}
              onToggle={(id, v) => editItems((items) => items.map((i) => (i.id === id ? { ...i, enabled: v } : i)))}
              onEdit={(id, text) => editItems((items) => items.map((i) => (i.id === id ? { ...i, text } : i)))}
              onRemove={remove}
              onUndo={undo}
              onAdd={addLine}
            />
          </section>
          <p role="status" className="m-0 min-h-6 font-bold text-ink">
            {phase === "saved" ? message : ""}
          </p>
          {phase === "plan" ? (
            <StickyActions>
              <Button kind="primary" block arrow onClick={confirm}>
                {GET_READY.looksRight}
              </Button>
            </StickyActions>
          ) : (
            <div>
              <ButtonLink kind="secondary" href="/practice">
                {GET_READY.goPractice}
              </ButtonLink>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** /get-ready: a chat that asks about the visit, then the plan to check, then the support card. One primary at a time. */
export function GetReadyScreen() {
  const { hydrated } = useRumi();
  const page = PAGES["/get-ready"];
  return (
    <div className="gr">
      <Scene />
      <Screen title={page.h1} lead={page.lead}>
        <div data-needs-js>{hydrated ? <GetReadyBody /> : null}</div>
      </Screen>
    </div>
  );
}
