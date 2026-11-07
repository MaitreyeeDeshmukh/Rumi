"use client";

import { useEffect, useRef, useState } from "react";
import { Block } from "@/components/home/Block";
import { TONAL } from "@/components/home/styles";
import { Button, ButtonLink } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { HOME } from "@/content/dashboard";
import { MEMORY_COPY } from "@/features/memory/consentCopy";
import { useMemoryControls } from "@/features/memory/useMemoryControls";
import { fill } from "@/lib/fill";

// What turning Memory on does, in the words the Settings screen and the privacy page already use.
const [WHAT, WHERE, NOT_SAVED, DELETE] = [MEMORY_COPY.body[0], MEMORY_COPY.body[4], MEMORY_COPY.body[5], MEMORY_COPY.body[7]];

/**
 * Privacy and the Memory switch. Turning Memory off is one press. Turning it on asks first, because it saves
 * sentences on Rumi's server. The switch flips only after the server says yes (the same actions Settings uses).
 */
export function MemoryCard({ className }: { className?: string }) {
  const { actions, enabled } = useMemoryControls();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const panel = useRef(null as HTMLDivElement | null);

  // The question opens under the switch: move focus into it so a keyboard or screen reader person lands on it.
  useEffect(() => {
    if (asking) panel.current?.focus();
  }, [asking]);

  const change = async (on: boolean) => {
    setBusy(true);
    setNote("");
    const res = await (on ? actions.enableMemory() : actions.disableMemory());
    setBusy(false);
    setAsking(false);
    setNote(res.remote === "paused" ? MEMORY_COPY.paused : res.ok ? MEMORY_COPY.saved : MEMORY_COPY.failed);
  };

  return (
    <Block title={HOME.privacyHeading} className={className}>
      <p>{HOME.saved}</p>
      <Toggle
        label={MEMORY_COPY.toggle}
        hint={fill(HOME.memory, { state: enabled ? HOME.memoryOn : HOME.memoryOff })}
        checked={enabled}
        disabled={busy}
        onCheckedChange={(on) => (on ? setAsking(true) : void change(false))}
      />
      {asking && !enabled ? (
        <div ref={panel} tabIndex={-1} className="mt-3 grid gap-2 rounded-card border-2 border-primary bg-primary-soft p-4 outline-none">
          <p className="m-0">{WHAT}</p>
          <p className="m-0">{WHERE}</p>
          <p className="m-0">{NOT_SAVED}</p>
          <p className="m-0">{DELETE}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button kind="secondary" className={TONAL} loading={busy} loadingLabel={HOME.memoryWorking} onClick={() => void change(true)}>
              {HOME.memoryTurnOn}
            </Button>
            <Button kind="tertiary" disabled={busy} onClick={() => setAsking(false)}>
              {HOME.memoryNotNow}
            </Button>
          </div>
        </div>
      ) : null}
      <p role="status" className="note m-0 mt-2 min-h-6">
        {note}
      </p>
      <ButtonLink kind="tertiary" href="/settings" className="mt-1 -ml-2 self-start">
        {HOME.manage}
      </ButtonLink>
    </Block>
  );
}
