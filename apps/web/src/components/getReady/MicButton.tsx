"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic } from "@/components/ui/icons";
import { GET_READY } from "@/content/getReady";
import { canRecord, recordAndTranscribe, type RecordEnd } from "@/lib/recordSpeech";

type Phase = "idle" | "listening" | "working";

/**
 * Dictation into the box: records from the microphone and has the server turn it into words (Groq Whisper).
 * Hidden when the browser cannot record. Says what went wrong (microphone refused, service down) instead of failing silently.
 */
export function MicButton({ onText }: { onText: (text: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const stop = useRef<(() => void) | null>(null);
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(canRecord()), []);
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
    setPhase("listening");
    stop.current = recordAndTranscribe(onText, (why: RecordEnd) => {
      setPhase("idle");
      stop.current = null;
      setNote(why === "denied" ? GET_READY.micDenied : why === "failed" ? GET_READY.micFailed : "");
    });
  };

  return (
    <div className="grid gap-2">
      <Button kind="tertiary" aria-pressed={phase === "listening"} disabled={phase === "working"} onClick={toggle}>
        <Mic aria-hidden="true" className="size-5" />
        {phase === "listening" ? GET_READY.micStop : phase === "working" ? GET_READY.micWorking : GET_READY.mic}
      </Button>
      <p role="status" className="note m-0">
        {note}
      </p>
    </div>
  );
}
