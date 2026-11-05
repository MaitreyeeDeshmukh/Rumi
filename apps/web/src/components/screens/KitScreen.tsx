'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { COPY } from '../copy';
import { buildKitText, shouldPlayFinishSound, useRumi } from '../deps';
import { copyText } from '../speech';
import { Button, Screen, Status } from '../ui';

const c = COPY.kit;

export function KitScreen() {
  const { state, hydrated } = useRumi();
  const [msg, setMsg] = useState('');
  const pre = useRef<HTMLPreElement>(null);
  const played = useRef(false);
  const ready = Boolean(state.plan && state.supportCard);
  const play = hydrated && ready && shouldPlayFinishSound(state.settings);

  // Opt-in finish tone, once per visit to this screen. Never plays when the setting is off.
  useEffect(() => {
    if (!play || played.current) return;
    played.current = true;
    try {
      const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 523; g.gain.value = 0.08; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.6);
    } catch { /* audio blocked: stay silent */ }
  }, [play]);

  if (!ready) {
    return (
      <Screen title={c.title} lead={c.lead}>
        <div className="empty"><p>{c.missing}</p><Link className="btn btn-primary" href="/get-ready">{COPY.common.goGetReady}</Link></div>
      </Screen>
    );
  }
  const text = buildKitText(state);
  return (
    <Screen title={c.ready} lead={c.lead}>
      <pre ref={pre} className="printable">{text}</pre>
      <div className="btn-row primary-slot">
        <Button variant="primary" icon="copy" onClick={async () => setMsg((await copyText(text, pre.current)) ? COPY.common.copied : COPY.common.copyFallback)}>{c.copy}</Button>
        <Button onClick={() => window.print()}>{c.print}</Button>
      </div>
      <Status>{msg}</Status>
    </Screen>
  );
}
