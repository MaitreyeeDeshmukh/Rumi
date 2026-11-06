"use client";

import { useEffect, useId, useRef } from "react";
import { useCopy } from "@/components/getReady/useCopy";
import { Button, ButtonLink } from "@/components/ui/button";
import { Copy, Printer } from "@/components/ui/icons";
import { Screen } from "@/components/ui/screen";
import { StickyActions } from "@/components/ui/sticky-actions";
import { KIT } from "@/content/getReady";
import { buildKitText, shouldPlayFinishSound } from "@/features/shims/getReadyKit";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";

/** A soft 0.6 s tone, no sound file. Called only when the person turned the setting on. */
function playFinishSound(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 523;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // no audio in this browser: the kit still works
  }
}

// One tone per page load, even when React runs the effect twice in development.
let played = false;

function KitBody({ text, sound }: { text: string; sound: boolean }) {
  const pre = useRef(null as HTMLPreElement | null);
  const label = useId();
  useEffect(() => {
    if (sound && !played) {
      played = true;
      playFinishSound();
    }
  }, [sound]);
  const { message, copy } = useCopy(KIT.copied, KIT.copyFailed);
  return (
    <div className="grid gap-4">
      <p className="m-0 font-bold text-ink" id={label}>
        {KIT.previewLabel}
      </p>
      <pre
        ref={pre}
        className="printable m-0 whitespace-pre-wrap break-words rounded-card border-2 border-line-strong bg-surface p-4 font-[inherit] text-base text-ink"
      >
        {text}
      </pre>
      <p role="status" className="m-0 min-h-6 text-ink">
        {message}
      </p>
      <StickyActions>
        <div className="grid gap-3 sm:flex sm:flex-wrap">
          <Button kind="primary" onClick={() => copy(text, pre.current)}>
            <Copy aria-hidden="true" className="size-5" />
            {KIT.copyKit}
          </Button>
          <Button kind="secondary" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-5" />
            {KIT.printKit}
          </Button>
        </div>
      </StickyActions>
    </div>
  );
}

/** /kit: the plan and support card as one text to copy or print, or a way back to Get ready. */
export function KitScreen() {
  const { state, hydrated } = useRumi();
  const page = PAGES["/kit"];
  const ready = hydrated && !!state.plan && !!state.supportCard;
  // Before the saved state loads, the neutral empty heading shows, so a wrong "ready" never flashes.
  const text = page.empty ?? page;
  const head = ready ? page : text;
  return (
    <Screen title={head.h1} lead={head.lead}>
      <div data-needs-js>
        {!hydrated ? null : ready ? (
          <KitBody text={buildKitText(state)} sound={shouldPlayFinishSound(state.settings)} />
        ) : (
          <StickyActions>
            <ButtonLink kind="primary" href="/get-ready" block arrow>
              {KIT.goGetReady}
            </ButtonLink>
          </StickyActions>
        )}
      </div>
    </Screen>
  );
}
