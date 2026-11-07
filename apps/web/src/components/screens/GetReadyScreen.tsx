"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useCrisis } from "@/components/CrisisProvider";
import { MicButton } from "@/components/getReady/MicButton";
import { Scene } from "@/components/getReady/Scene";
import { PlanList, type Removed } from "@/components/getReady/PlanList";
import { SupportCardSection } from "@/components/getReady/SupportCardSection";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { ArrowUp } from "@/components/ui/icons";
import { Screen } from "@/components/ui/screen";
import { StickyActions } from "@/components/ui/sticky-actions";
import { GET_READY } from "@/content/getReady";
import { newSupportCard, planCall, splitIntoPlanLines } from "@/features/adapters/getReadyKit";
import { isCrisis } from "@/lib/crisis";
import type { PlanItem, RumiState, VisitPlan } from "@/features/shared/types";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

/** Suggested lines always start switched off, whatever the reply says. */
const offUntilChosen = (plan: VisitPlan): VisitPlan => ({
  ...plan,
  items: plan.items.map((i) => (i.source === "suggested" ? { ...i, enabled: false } : i)),
});

function GetReadyBody() {
  const { state, update } = useRumi();
  const { show } = useCrisis();
  const uid = useId();
  const box = useRef(null as HTMLTextAreaElement | null);
  const [rawText, setRawText] = useState("");
  const [blank, setBlank] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null as string | null);
  const [degraded, setDegraded] = useState(false);
  const [draft, setDraft] = useState(null as VisitPlan | null);
  const [removed, setRemoved] = useState(null as Removed | null);
  const [message, setMessage] = useState("");
  const [micNote, setMicNote] = useState("");

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
    setLoading(true);
    const r = await planCall(text, state.settings.companionName);
    setLoading(false);
    if (r.ok) {
      setDraft(offUntilChosen(r.data.plan));
      setDegraded(r.data.degraded === true);
    } else if ("crisis" in r) {
      show();
    } else {
      setError(r.error.message);
    }
  };

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
        <form data-phase="empty" onSubmit={make} className="mx-auto mt-8 grid w-full max-w-4xl gap-4">
          <div className="flex items-end gap-1 rounded-[28px] border-2 border-line-strong bg-surface p-2 pl-5 shadow-[var(--shadow)] focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus">
            <label htmlFor={`${uid}-box`} className="sr-only">
              {GET_READY.boxLabel}
            </label>
            <textarea
              ref={box}
              id={`${uid}-box`}
              rows={1}
              maxLength={2000}
              placeholder={GET_READY.boxHint}
              aria-invalid={blank}
              aria-describedby={blank ? `${uid}-blank` : undefined}
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
              disabled={loading}
              aria-busy={loading || undefined}
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
          <div className="flex flex-wrap justify-center gap-2">
            {GET_READY.starters.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => {
                  setRawText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
                  setBlank(false);
                  box.current?.focus();
                }}
                className="min-h-10 rounded-full border border-line bg-surface px-4 text-[.95rem] font-bold text-ink hover:bg-lav"
              >
                {text}
              </button>
            ))}
          </div>
          <p className="m-0 text-center text-muted-ink">{GET_READY.whatNext}</p>
          {error !== null ? (
            <Notice tone="warn" title={GET_READY.errorTitle}>
              {error ? <p>{error}</p> : null}
              <Button kind="secondary" className="mt-2" onClick={() => void make()}>
                {GET_READY.tryAgain}
              </Button>
            </Notice>
          ) : null}
          <p role="status" className="m-0 min-h-6 text-ink">
            {loading ? GET_READY.loading : ""}
          </p>
        </form>
      ) : (
        <div data-phase={phase} className="grid gap-5">
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
          {phase === "saved" && plan && card ? <SupportCardSection plan={plan} card={card} /> : null}
          <StickyActions>
            {phase === "plan" ? (
              <Button kind="primary" block arrow onClick={confirm}>
                {GET_READY.looksRight}
              </Button>
            ) : (
              <ButtonLink kind="primary" href="/practice" block arrow>
                {GET_READY.goPractice}
              </ButtonLink>
            )}
          </StickyActions>
        </div>
      )}
    </>
  );
}

/** /get-ready: describe the concern, check the plan, then the support card. One primary at a time. */
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
