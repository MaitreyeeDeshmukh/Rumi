"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Mic } from "@/components/ui/icons";
import { GET_READY } from "@/content/getReady";
import { canRecord, recordAndTranscribe, type RecordEnd } from "@/lib/recordSpeech";

const noSubscribe = () => () => {};

type Phase = "idle" | "listening" | "working";

/**
 * Dictation into the box: records from the microphone and has the server turn it into words (Groq Whisper).
 * Hidden when the browser cannot record. Says what went wrong (microphone refused, service down) instead of failing silently.
 */
export function MicButton({ onText, compact = false, onNote }: { onText: (text: string) => void; /** An icon-only button, for inside the prompt bar. */ compact?: boolean; /** With it, a problem is reported to the caller instead of shown under the button. */ onNote?: (note: string) => void }) {
  const [phase, setPhase] = useState("idle" as Phase);
  const [note, setNote] = useState("");
  const stop = useRef(null as (() => void) | null);
  const supported = useSyncExternalStore(noSubscribe, canRecord, () => false); // false on the server and first paint, then the real answer
  useEffect(() => () => stop.current?.(), []);
  if (!supported) return null;

  const toggle = () => {
    if (phase === "listening") {
      setPhase("working");
      stop.current?.();
      return;
    }
    if (phase === "working") return;
    setNote("");
    onNote?.("");
    setPhase("listening");
    stop.current = recordAndTranscribe(onText, (why: RecordEnd) => {
      setPhase("idle");
      stop.current = null;
      const text = why === "denied" ? GET_READY.micDenied : why === "failed" ? GET_READY.micFailed : "";
      setNote(text);
      onNote?.(text);
    });
  };

  const label = phase === "listening" ? GET_READY.micStop : phase === "working" ? GET_READY.micWorking : GET_READY.mic;
  if (compact) {
    return (
      <button
        type="button"
        aria-pressed={phase === "listening"}
        aria-label={label}
        disabled={phase === "working"}
        onClick={toggle}
        className={`grid size-12 shrink-0 place-items-center rounded-full text-ink hover:bg-lav disabled:opacity-60 ${phase === "listening" ? "bg-lav" : ""}`}
      >
        <Mic aria-hidden="true" className="size-5" />
      </button>
    );
  }

  return (
    <div className="grid gap-2">
      <Button kind="tertiary" aria-pressed={phase === "listening"} disabled={phase === "working"} onClick={toggle}>
        <Mic aria-hidden="true" className="size-5" />
        {label}
      </Button>
      <p role="status" className="note m-0">
        {note}
      </p>
    </div>
  );
}
