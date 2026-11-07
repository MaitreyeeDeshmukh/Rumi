"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCrisis } from "@/components/CrisisProvider";
import { AppointmentPicker } from "@/components/appointments/AppointmentPicker";
import { RecapView } from "@/components/remember/RecapView";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { StickyActions } from "@/components/ui/sticky-actions";
import { APPT } from "@/content/appointments";
import { NAV } from "@/content/nav";
import { PAGES_COPY } from "@/content/pages";
import { REMEMBER } from "@/content/remember";
import { SAMPLE_VISIT } from "@/fixtures/sampleVisit";
import { SAVED_REPLY, buildOwnRecap, buildRecap, quoted, requestRecap, requestRecapLines, voicesOf } from "@/features/adapters/remember";
import { transcriptLines } from "@/features/appointments/appointments";
import type { Recap, RumiState, Speaker, Visit } from "@/features/shared/types";
import { fill } from "@/lib/fill";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

type Phase =
  | { k: "intro" }
  | { k: "pick" }
  | { k: "loading" }
  | { k: "error"; speaker: Speaker; visit?: Visit }
  | { k: "recap"; recap: Recap };

const PRIMARY = PAGES_COPY["/remember"].primary;

/** /remember: the sample visit only. Intro, voice picker, recap. No recording, no microphone. */
export function RememberScreen() {
  const { state, update, hydrated } = useRumi();
  const visitId = useSearchParams().get("visit");
  const visits = state.visits ?? [];
  // The visit named in the address, else the latest one saved.
  const mine = visits.find((v) => v.id === visitId) ?? (visitId ? undefined : visits[visits.length - 1]);
  const { show } = useCrisis();
  // With no visit in the address, the person picks the appointment whose recording they want to recap.
  const appointments = state.appointments ?? [];
  const withVisit = appointments.filter((a) => visits.some((v) => v.apptId === a.id));
  const loose = visits.filter((v) => !v.apptId);
  const showPicker = !visitId && (withVisit.length > 0 || loose.length > 0);
  const [pick, setPick] = useState("");
  const [pickNow] = useState(() => new Date());
  const recordings = (a: { id: string }) => visits.filter((v) => v.apptId === a.id).length;
  const continuePick = () => {
    if (pick === "sample") return setPhase({ k: "pick" });
    const chosen = pick === "loose" ? loose : visits.filter((v) => v.apptId === pick);
    const latest = chosen[chosen.length - 1];
    if (latest) void runMine(latest);
  };
  const [phase, setPhase] = useState({ k: "intro" } as Phase);
  const [speaker, setSpeaker] = useState("");
  const fails = useRef(0);
  const live = useRef(null as HTMLDivElement | null);

  // Move focus to the new state so a keyboard or screen reader user lands on it.
  const key = phase.k;
  useEffect(() => {
    if (key !== "intro") live.current?.focus();
  }, [key]);

  const finish = (recap: Recap) => {
    update((draft: RumiState) => {
      draft.recap = recap;
    });
    setPhase({ k: "recap", recap });
  };

  const run = async (who: Speaker) => {
    setPhase({ k: "loading" });
    const res = await requestRecap(who);
    if (res.kind === "ok") {
      fails.current = 0;
      return finish(buildRecap(res.reply, who, false));
    }
    if (res.kind === "crisis") {
      setPhase({ k: "pick" });
      return show();
    }
    fails.current += 1;
    if (fails.current >= 2) {
      fails.current = 0;
      return finish(buildRecap(SAVED_REPLY, who, true));
    }
    setPhase({ k: "error", speaker: who });
  };

  const runMine = async (visit: Visit) => {
    setPhase({ k: "loading" });
    const lines = transcriptLines(visit.text);
    const res = lines.length > 0 ? await requestRecapLines(lines) : ({ kind: "error" } as const);
    if (res.kind === "ok") return setPhase({ k: "recap", recap: buildOwnRecap(res.reply, lines) });
    if (res.kind === "crisis") {
      setPhase({ k: "intro" });
      return show();
    }
    setPhase({ k: "error", speaker: "B", visit });
  };

  const voices = voicesOf(SAMPLE_VISIT);

  return (
    <Screen title={PAGES["/remember"].h1} lead={PAGES["/remember"].lead} footer>
      <div data-needs-js>
        {!hydrated ? null : (
          <div ref={live} tabIndex={-1} className="grid gap-5 outline-none">
            {phase.k === "intro" && showPicker && (
              <div className="grid max-w-2xl gap-5">
                <AppointmentPicker
                  appointments={withVisit}
                  value={pick}
                  onChange={setPick}
                  now={pickNow}
                  note={(a) => (recordings(a) > 0 ? APPT.pickWithRecording : null)}
                  extra={[
                    ...(loose.length > 0 ? [{ value: "loose", title: APPT.pickLoose }] : []),
                    { value: "sample", title: APPT.pickSample, hint: APPT.pickSampleHint },
                  ]}
                />
                <div className="grid gap-2">
                  <div>
                    <Button kind="primary" arrow disabled={!pick} onClick={continuePick}>
                      {APPT.pickContinue}
                    </Button>
                  </div>
                  {pick ? null : <p className="note m-0">{APPT.pickFirst}</p>}
                </div>
                <p className="note m-0">{APPT.myVisitCrisisNote}</p>
              </div>
            )}

            {phase.k === "intro" && !showPicker && (
              <>
                {mine ? (
                  <div className="grid gap-2">
                    <p className="m-0">{APPT.myVisitBody}</p>
                    <p className="note m-0">{APPT.myVisitCrisisNote}</p>
                    <Button kind="primary" arrow block onClick={() => void runMine(mine)}>
                      {APPT.myVisit}
                    </Button>
                  </div>
                ) : (
                  <p className="note m-0">{APPT.myVisitNone}</p>
                )}
                <p className="m-0 font-bold">{APPT.orSample}</p>
                <Banner>{REMEMBER.sampleLabel}</Banner>
                <p className="note m-0">{REMEMBER.sampleNote}</p>
                <StickyActions>
                  <Button kind="primary" arrow block onClick={() => setPhase({ k: "pick" })}>
                    {PRIMARY.intro}
                  </Button>
                </StickyActions>
              </>
            )}

            {phase.k === "pick" && (
              <>
                <fieldset className="m-0 grid gap-3 border-0 p-0">
                  <legend className="mb-1 p-0 text-xl font-bold text-ink">{REMEMBER.pickLegend}</legend>
                  <ChoiceGroup aria-label={REMEMBER.pickLegend} value={speaker} onValueChange={setSpeaker}>
                    {voices.map((v) => (
                      <ChoiceCard key={v.speaker} value={v.speaker} title={fill(REMEMBER.voice, { speaker: v.speaker })}>
                        {quoted(v.first)}
                      </ChoiceCard>
                    ))}
                  </ChoiceGroup>
                </fieldset>
                <StickyActions>
                  <Button kind="primary" block disabled={!speaker} onClick={() => run(speaker as Speaker)}>
                    {PRIMARY.picker}
                  </Button>
                  {speaker ? null : <p className="note mt-2 mb-0">{REMEMBER.pickFirst}</p>}
                </StickyActions>
              </>
            )}

            {phase.k === "loading" && (
              <p role="status" className="m-0 text-lg font-bold">
                {REMEMBER.loading}
              </p>
            )}

            {phase.k === "error" && (
              <>
                <Notice tone="warn" title={REMEMBER.errorTitle}>
                  <p>{REMEMBER.errorBody}</p>
                </Notice>
                <StickyActions>
                  <Button kind="primary" block onClick={() => (phase.visit ? void runMine(phase.visit) : run(phase.speaker))}>
                    {NAV.tryAgain}
                  </Button>
                </StickyActions>
              </>
            )}

            {phase.k === "recap" && (
              <>
                {phase.recap.isSavedFallback ? <Banner>{REMEMBER.saved}</Banner> : null}
                <RecapView recap={phase.recap} primary={PRIMARY.recap} />
              </>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}
