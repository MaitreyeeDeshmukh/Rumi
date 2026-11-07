"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { COPY } from "@/components/copy";
import { useCrisis } from "@/components/CrisisProvider";
import { Scene } from "@/components/getReady/Scene";
import { CallScreen } from "@/components/practice/CallScreen";
import { SourcePicker, type Choice } from "@/components/practice/SourcePicker";
import { Summary } from "@/components/practice/Summary";
import { PRACTICE } from "@/content/practice";
import { planFromWords, readFileWords, type ReadResult } from "@/features/practice/processSource";
import { generalPlan, planFromAppointment } from "@/features/practice/sources";
import type { PracticeSession, RumiState, VisitPlan } from "@/features/shared/types";
import { dayLong, isoDate } from "@/features/appointments/appointments";
import { fill } from "@/lib/fill";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

type View = { phase: "source" } | { phase: "call" } | { phase: "summary"; sessionId: string };

/** What went wrong reading a file, in words. */
const FILE_PROBLEM: Record<Exclude<ReadResult, { ok: true }>["code"], string> = {
  bad_type: PRACTICE.fileBadType,
  too_big: PRACTICE.fileTooBig,
  empty: PRACTICE.fileEmpty,
  failed: PRACTICE.fileFailed,
};

/** /practice: choose what to practice with (my plan, general practice, a booked visit, a recording, a file), pick a part, the call, then the summary. */
export function PracticeScreen() {
  const { state, update, hydrated } = useRumi();
  const { show } = useCrisis();
  const apptParam = useSearchParams().get("appt");
  const [view, setView] = useState({ phase: "source" } as View);
  const [active, setActive] = useState(null as { plan: VisitPlan; name: string } | null);
  const [busy, setBusy] = useState(null as string | null);
  const [messages, setMessages] = useState({} as Record<string, string>);
  const [note, setNote] = useState("");
  const title = useRef(null as HTMLHeadingElement | null);
  const page = PAGES["/practice"];

  const go = (next: View) => {
    setView(next);
    requestAnimationFrame(() => title.current?.focus());
  };

  const begin = (plan: VisitPlan, name: string, trimmed = false) => {
    setActive({ plan, name });
    setNote(trimmed ? PRACTICE.fileTrimmed : "");
    go({ phase: "call" });
  };

  /** Words (from a recording or a file) become practice lines with the same call Get ready uses. */
  const fromWords = async (key: string, words: string, name: string, trimmed: boolean) => {
    setBusy(key);
    const r = await planFromWords(words, state.settings.companionName, `${key}-${Date.now().toString(36)}`.slice(0, 40));
    setBusy(null);
    if (r.ok) return begin(r.plan, name, trimmed);
    if (r.crisis) return show();
    setMessages({ [key]: key === "file" ? PRACTICE.fileFailed : PRACTICE.makingFailed });
  };

  const choose = async (c: Choice) => {
    setMessages({});
    if (c.kind === "plan") return state.plan ? begin(state.plan, PRACTICE.myPlanTitle) : undefined;
    if (c.kind === "general") return begin(generalPlan(), PRACTICE.generalName);
    if (c.kind === "appt") {
      const a = (state.appointments ?? []).find((x) => x.id === c.id);
      if (!a) return;
      const p = planFromAppointment(a);
      return p ? begin(p, a.providerName) : setMessages({ [`appt-${c.id}`]: PRACTICE.visitNoNotes });
    }
    if (c.kind === "visit") {
      const v = (state.visits ?? []).find((x) => x.id === c.id);
      if (!v) return;
      return fromWords(`visit-${v.id}`, v.text, fill(PRACTICE.recordingName, { day: dayLong(isoDate(new Date(v.createdAt))) }), false);
    }
    setBusy("file");
    const r = await readFileWords(c.file);
    if (!r.ok) {
      setBusy(null);
      return setMessages({ file: FILE_PROBLEM[r.code] });
    }
    return fromWords("file", r.text, PRACTICE.fileName, r.trimmed);
  };

  // A link from a booked visit ("/practice?appt=...") starts with that visit already chosen.
  const linked = useRef(false);
  useEffect(() => {
    if (!hydrated || !apptParam || linked.current) return;
    linked.current = true;
    void choose({ kind: "appt", id: apptParam });
    // choose only reads state that is loaded once `hydrated` is true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, apptParam]);

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

  const choosing = view.phase === "source" || !active;
  const lead = view.phase === "summary" ? PRACTICE.summaryLead : choosing ? PRACTICE.sourceLead : page.lead;

  let body;
  if (!hydrated) {
    body = <p>{PRACTICE.loading}</p>;
  } else if (view.phase === "summary" && session && active) {
    body = (
      <Summary
        session={session}
        before={sessionIndex > 0 ? state.sessions[sessionIndex - 1] : undefined}
        plan={active.plan}
        onToggle={(itemId, covered) =>
          patchSession(session.id, (s) => {
            s.coveredItemIds = covered
              ? [...new Set([...s.coveredItemIds, itemId])]
              : s.coveredItemIds.filter((id) => id !== itemId);
          })
        }
        onAgain={() => go({ phase: "call" })}
      />
    );
  } else if (choosing) {
    body = (
      <SourcePicker
        plan={state.plan}
        appointments={state.appointments ?? []}
        visits={state.visits ?? []}
        busy={busy}
        messages={messages}
        onPick={(c) => void choose(c)}
      />
    );
  } else {
    body = <CallScreen plan={active.plan} note={note || undefined} onFinish={finish} />;
  }

  return (
    <div className="gr">
      <Scene />
      <div className="page-enter">
        <h1 ref={title} tabIndex={-1}>
          {page.h1}
        </h1>
        <p className="intro">{lead}</p>
        <div data-needs-js>{body}</div>
        <p className="note mt-8">{COPY.notDoctor}</p>
      </div>
    </div>
  );
}
