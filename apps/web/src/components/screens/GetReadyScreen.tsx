"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useCrisis } from "@/components/CrisisProvider";
import { MicButton } from "@/components/getReady/MicButton";
import { PlanList, type Removed } from "@/components/getReady/PlanList";
import { SupportCardSection } from "@/components/getReady/SupportCardSection";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { StickyActions } from "@/components/ui/sticky-actions";
import { GET_READY } from "@/content/getReady";
import { newSupportCard, planCall } from "@/features/adapters/getReadyKit";
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
  const addLine = (text: string) =>
    editItems((items) => [...items, { id: `u-${Date.now().toString(36)}`, text, kind: "concern", source: "user", enabled: true }]);

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
        <form onSubmit={make} className="grid gap-4">
          <Field id={`${uid}-box`} label={GET_READY.boxLabel} hint={GET_READY.boxHint} error={blank ? GET_READY.blank : undefined}>
            <textarea
              ref={box}
              rows={6}
              maxLength={2000}
              className={fieldControlClass}
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setBlank(false);
              }}
            />
          </Field>
          <MicButton onText={(t) => setRawText((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))} />
          <p className="m-0 text-muted-ink">{GET_READY.whatNext}</p>
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
          <StickyActions>
            <Button kind="primary" type="submit" block arrow loading={loading}>
              {GET_READY.makePlan}
            </Button>
          </StickyActions>
        </form>
      ) : (
        <div className="grid gap-5">
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
    <Screen title={page.h1} lead={page.lead}>
      <div data-needs-js>{hydrated ? <GetReadyBody /> : null}</div>
    </Screen>
  );
}
