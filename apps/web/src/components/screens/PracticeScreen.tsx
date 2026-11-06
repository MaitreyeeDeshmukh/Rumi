"use client";

import { useRef, useState } from "react";
import { COPY } from "@/components/copy";
import { CallScreen } from "@/components/practice/CallScreen";
import { Readiness, type Ready } from "@/components/practice/Readiness";
import { Summary } from "@/components/practice/Summary";
import { ButtonLink, Button } from "@/components/ui/button";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StickyActions } from "@/components/ui/sticky-actions";
import { PRACTICE } from "@/content/practice";
import { FOCUS_LABEL, itemsForFocus } from "@/features/practice/labels";
import type { Focus, PracticeSession, RumiState } from "@/features/shared/types";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

const FOCUSES: Focus[] = ["problem", "questions", "needs", "next_steps", "whole"];

type View = { phase: "picker" } | { phase: "call" } | { phase: "summary"; sessionId: string };

/** /practice: no plan, pick a part, the call, then the summary. The call is a full-screen layer (CallScreen). */
export function PracticeScreen() {
  const { state, update, hydrated } = useRumi();
  const [view, setView] = useState({ phase: "picker" } as View);
  const [focus, setFocus] = useState("whole" as Focus);
  const [ready, setReady] = useState(undefined as Ready | undefined);
  const title = useRef(null as HTMLHeadingElement | null);
  const page = PAGES["/practice"];
  const plan = state.plan;

  const go = (next: View) => {
    setView(next);
    requestAnimationFrame(() => title.current?.focus());
  };

  const finish = (session: PracticeSession) => {
    update((draft: RumiState) => {
      draft.sessions.push(session);
    });
    go({ phase: "summary", sessionId: session.id });
  };

  const patchSession = (id: string, change: (s: PracticeSession) => void) =>
    update((draft: RumiState) => {
      const s = draft.sessions.find((x) => x.id === id);
      if (s) change(s);
    });

  const sessionIndex = view.phase === "summary" ? state.sessions.findIndex((s) => s.id === view.sessionId) : -1;
  const session = sessionIndex >= 0 ? state.sessions[sessionIndex] : undefined;

  const lead = view.phase === "summary" ? PRACTICE.summaryLead : page.lead;
  const noLines = plan ? itemsForFocus(plan, focus).length === 0 : true;

  let body;
  if (!hydrated) {
    body = <p>{PRACTICE.loading}</p>;
  } else if (view.phase === "summary" && session && plan) {
    body = (
      <Summary
        session={session}
        before={sessionIndex > 0 ? state.sessions[sessionIndex - 1] : undefined}
        plan={plan}
        onToggle={(itemId, covered) =>
          patchSession(session.id, (s) => {
            s.coveredItemIds = covered
              ? [...new Set([...s.coveredItemIds, itemId])]
              : s.coveredItemIds.filter((id) => id !== itemId);
          })
        }
        onReadyAfter={(value) => patchSession(session.id, (s) => void (s.readyAfter = value))}
        onAgain={() => go({ phase: "picker" })}
      />
    );
  } else if (!plan || plan.items.every((i) => !i.enabled)) {
    body = (
      <EmptyState
        title={PRACTICE.noPlanTitle}
        action={
          <StickyActions>
            <ButtonLink kind="primary" href="/get-ready" arrow>
              {PRACTICE.goGetReady}
            </ButtonLink>
          </StickyActions>
        }
      >
        <p>{PRACTICE.noPlanText}</p>
      </EmptyState>
    );
  } else if (view.phase === "call") {
    body = <CallScreen plan={plan} focus={focus} readyBefore={ready} onFinish={finish} />;
  } else {
    body = (
      <div className="grid gap-6">
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
          <legend className="mb-1 p-0 font-bold text-ink">{PRACTICE.focusLegend}</legend>
          <ChoiceGroup aria-label={PRACTICE.focusLegend} value={focus} onValueChange={(v) => setFocus(v as Focus)}>
            {FOCUSES.map((f) => (
              <ChoiceCard key={f} value={f} title={FOCUS_LABEL[f]} />
            ))}
          </ChoiceGroup>
        </fieldset>
        <Readiness label={PRACTICE.readyLabel} hint={PRACTICE.readyHint} value={ready} onChange={setReady} />
        <StickyActions>
          <div className="grid gap-2">
            {noLines ? <p className="note m-0">{PRACTICE.noLines}</p> : null}
            <Button kind="primary" arrow block disabled={noLines} onClick={() => go({ phase: "call" })}>
              {PRACTICE.start}
            </Button>
          </div>
        </StickyActions>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <h1 ref={title} tabIndex={-1}>
        {page.h1}
      </h1>
      <p className="intro">{lead}</p>
      <div data-needs-js>{body}</div>
      <p className="note mt-8">{COPY.notDoctor}</p>
    </div>
  );
}
