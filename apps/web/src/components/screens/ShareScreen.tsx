'use client';
import { useRef, useState, useSyncExternalStore } from 'react';
import { COPY } from '../copy';
import { buildShareText, useRumi, type ShareKey } from '../deps';
import { copyText } from '../speech';
import { Button, Screen, Status } from '../ui';

const c = COPY.share;
const KEYS: readonly ShareKey[] = ['plan', 'support', 'discussed', 'instructions', 'medications', 'next_steps', 'said'];
const noop = (): (() => void) => () => {};

export function ShareScreen() {
  const { state } = useRumi();
  const [sel, setSel] = useState<ReadonlySet<ShareKey>>(new Set());
  const [msg, setMsg] = useState('');
  const pre = useRef<HTMLPreElement>(null);
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === 'function', () => false);

  const has: Record<ShareKey, boolean> = {
    plan: Boolean(state.plan),
    support: Boolean(state.supportCard),
    discussed: Boolean(state.recap?.items.some((i) => i.section === 'discussed')),
    instructions: Boolean(state.recap?.items.some((i) => i.section === 'instructions')),
    medications: Boolean(state.recap?.items.some((i) => i.section === 'medications')),
    next_steps: Boolean(state.recap?.items.some((i) => i.section === 'next_steps')),
    said: Boolean(state.recap?.planStatus.length && state.plan),
  };
  // One variable feeds both the preview and the clipboard.
  const text = buildShareText(sel, state);

  function toggle(k: ShareKey, on: boolean): void {
    setSel((s) => { const n = new Set(s); if (on) n.add(k); else n.delete(k); return n; });
    setMsg('');
  }

  return (
    <Screen title={c.title} lead={c.lead}>
      <fieldset className="field">
        <legend className="lbl">{c.title}</legend>
        {KEYS.map((k) => (
          <label key={k} className="check-row">
            <input type="checkbox" checked={sel.has(k)} disabled={!has[k]} onChange={(e) => toggle(k, e.target.checked)} />
            <span>{c.options[k]}</span>
            {!has[k] ? <span className="hint">{c.missing}</span> : null}
          </label>
        ))}
      </fieldset>
      <h2>{c.preview}</h2>
      <pre ref={pre} className="share-preview" aria-live="polite">{text || c.empty}</pre>
      <p className="hint"><strong>{c.noSend}</strong></p>
      <div className="btn-row">
        <Button variant="primary" icon="copy" disabled={!text} onClick={async () => setMsg((await copyText(text, pre.current)) ? COPY.common.copied : COPY.common.copyFallback)}>{c.copy}</Button>
        {canShare ? <Button icon="share" disabled={!text} onClick={() => { navigator.share({ text }).catch(() => {}); }}>{c.share}</Button> : null}
      </div>
      <Status>{msg}</Status>
    </Screen>
  );
}
