'use client';
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { COPY } from './copy';

const Ctx = createContext<{ show: () => void } | null>(null);

/** Contract 4.7. Any screen that gets `{ ok:false, crisis:true }` or sees isCrisis(text) calls show(). */
export const useCrisis = (): { show: () => void } => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCrisis outside CrisisProvider');
  return v;
};

export function CrisisProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const show = useCallback(() => {
    const d = ref.current;
    if (!d || d.open) return;
    opener.current = document.activeElement;
    d.showModal();
  }, []);
  const close = (): void => { ref.current?.close(); (opener.current as HTMLElement | null)?.focus?.(); };
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Esc is blocked so the card cannot be dismissed without "I understand". */}
      <dialog ref={ref} className="crisis" aria-labelledby="crisis-title" aria-describedby="crisis-body" onCancel={(e) => e.preventDefault()}>
        <h2 id="crisis-title">{COPY.crisis.title}</h2>
        <p id="crisis-body">{COPY.crisis.body}</p>
        <div className="crisis-actions">
          <a className="btn btn-primary" href="tel:988">{COPY.crisis.call988}</a>
          <a className="btn btn-secondary" href="sms:988">{COPY.crisis.text988}</a>
          <a className="btn btn-secondary" href="tel:911">{COPY.crisis.call911}</a>
        </div>
        <button type="button" className="btn btn-ghost" onClick={close}>{COPY.crisis.ack}</button>
      </dialog>
    </Ctx.Provider>
  );
}
