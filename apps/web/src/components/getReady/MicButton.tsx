"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic } from "@/components/ui/icons";
import { GET_READY } from "@/content/getReady";

type Recognition = {
  lang: string;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;

const ctorOf = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** Dictation into the box. Hidden (not disabled) when the browser has no speech input. Render on the client only. */
export function MicButton({ onText }: { onText: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const rec = useRef(null as Recognition | null);
  const Ctor = ctorOf();
  if (!Ctor) return null;

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = document.documentElement.lang || "en-US";
    r.continuous = false;
    r.onresult = (e) => onText(Array.from(e.results, (x) => x[0].transcript).join(" "));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  return (
    <Button kind="tertiary" aria-pressed={listening} onClick={toggle}>
      <Mic aria-hidden="true" className="size-5" />
      {listening ? GET_READY.micStop : GET_READY.mic}
    </Button>
  );
}
