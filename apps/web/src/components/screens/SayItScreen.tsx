"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { useCrisis } from "@/components/CrisisProvider";
import { Button } from "@/components/ui/button";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { StickyActions } from "@/components/ui/sticky-actions";
import { SAYIT } from "@/content/sayit";
import { callApi } from "@/features/shims/callApi";
import type { ScenarioId } from "@/features/shims/sayit";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

const REPLY = z.object({ script: z.string(), blanks: z.array(z.string()) });
type Level = 2 | 3;
type View = { scenario: ScenarioId; level: Level; script: string | null; loading: boolean; failed: boolean };

const subscribeNever = () => () => {};
const hasSpeech = () => Boolean(window.speechSynthesis) && typeof SpeechSynthesisUtterance === "function";

/** /say-it: five scenarios, then one short script the person can edit, read aloud or copy. */
export function SayItScreen() {
  const page = PAGES["/say-it"];
  const { state } = useRumi();
  const { show: showCrisis } = useCrisis();
  const id = useId();
  const [view, setView] = useState(null as View | null);
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState("");
  const box = useRef(null as HTMLTextAreaElement | null);
  const latest = useRef(0);
  const speech = useSyncExternalStore(subscribeNever, hasSpeech, () => false);

  const stop = () => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  // Esc stops the voice. The listener exists only while it is reading.
  useEffect(() => {
    if (!speaking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speaking]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const request = async (scenario: ScenarioId, level: Level, keep: string | null) => {
    const mine = ++latest.current;
    stop();
    setStatus("");
    setView({ scenario, level, script: keep, loading: true, failed: false });
    const result = await callApi("/api/sayit", { scenario, level }, REPLY);
    if (mine !== latest.current) return;
    if (result.ok) {
      setView({ scenario, level, script: result.data.script, loading: false, failed: false });
    } else if ("crisis" in result) {
      setView(null);
      showCrisis();
    } else {
      setView({ scenario, level, script: keep, loading: false, failed: true });
    }
  };

  const read = () => {
    const text = box.current?.value ?? "";
    if (!text) return;
    window.speechSynthesis.cancel();
    const talk = new SpeechSynthesisUtterance(text);
    talk.rate = state.settings.speechRate;
    talk.onend = () => setSpeaking(false);
    talk.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(talk);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(box.current?.value ?? "");
      setStatus(SAYIT.copied);
    } catch {
      box.current?.select();
      setStatus(SAYIT.copyFailed);
    }
  };

  const back = () => {
    latest.current++;
    stop();
    setStatus("");
    setView(null);
  };

  const scenarioLabel = SAYIT.scenarios.find((s) => s.id === view?.scenario)?.label;
  const failed = view?.failed ? (
    <Notice tone="warn">
      <p>{SAYIT.error}</p>
      <div className="mt-2">
        <Button kind="secondary" onClick={() => request(view.scenario, view.level, view.script)}>
          {SAYIT.tryAgain}
        </Button>
      </div>
    </Notice>
  ) : null;

  return (
    <Screen title={page.h1} lead={page.lead}>
      <div data-needs-js className="grid gap-6">
        {view?.script != null ? (
          <section aria-labelledby={`${id}-title`} className="grid gap-4">
            <h2 id={`${id}-title`} className="m-0 text-xl">
              {scenarioLabel}
            </h2>
            <Field id={`${id}-script`} label={SAYIT.scriptLabel} hint={SAYIT.scriptHint}>
              {/* Keyed by the script, so a new script from the AI replaces what is in the box. */}
              <textarea
                key={view.script}
                ref={box}
                rows={5}
                defaultValue={view.script}
                disabled={view.loading}
                className={fieldControlClass}
              />
            </Field>
            {view.loading ? <p className="m-0">{SAYIT.writing}</p> : null}
            {failed}
            <div className="flex flex-wrap gap-3">
              {speech ? (
                speaking ? (
                  <Button kind="secondary" onClick={stop}>
                    {SAYIT.stopReading}
                  </Button>
                ) : (
                  <Button kind="secondary" onClick={read} disabled={view.loading}>
                    {SAYIT.readAloud}
                  </Button>
                )
              ) : null}
              {view.level === 3 ? null : (
                <Button kind="secondary" onClick={() => request(view.scenario, 3, view.script)} disabled={view.loading}>
                  {SAYIT.simpler}
                </Button>
              )}
              <Button kind="tertiary" onClick={back}>
                {SAYIT.another}
              </Button>
            </div>
            {speaking ? <p className="note m-0">{SAYIT.reading}</p> : null}
            <p className="note m-0">{SAYIT.note}</p>
            <StickyActions>
              <Button kind="primary" block onClick={copy} disabled={view.loading}>
                {SAYIT.copy}
              </Button>
            </StickyActions>
            <p role="status" className="note m-0 min-h-6">
              {status}
            </p>
          </section>
        ) : (
          <section aria-labelledby={`${id}-list`} className="grid gap-3">
            <h2 id={`${id}-list`} className="m-0 text-xl">
              {SAYIT.listTitle}
            </h2>
            {view?.loading ? <p role="status" className="m-0">{SAYIT.writing}</p> : null}
            {failed}
            {SAYIT.scenarios.map((s) => (
              <Button key={s.id} kind="secondary" block disabled={view?.loading} onClick={() => request(s.id, 2, null)}>
                {s.label}
              </Button>
            ))}
            <p className="note m-0">{SAYIT.note}</p>
          </section>
        )}
      </div>
    </Screen>
  );
}
