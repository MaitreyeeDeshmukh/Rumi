"use client";

import { createContext, useCallback, useContext, useId, useMemo, useRef, type ReactNode } from "react";
import { ButtonLink, Button } from "@/components/ui/button";
import { CRISIS } from "@/content/crisis";

type CrisisApi = { show: () => void };
const CrisisContext = createContext(null as CrisisApi | null);

export function useCrisis(): CrisisApi {
  const api = useContext(CrisisContext);
  if (!api) throw new Error("useCrisis must be used inside CrisisProvider");
  return api;
}

/** Native modal dialog. Esc cannot dismiss it: only "I understand" can. */
export function CrisisProvider({ children }: { children: ReactNode }) {
  const ref = useRef(null as HTMLDialogElement | null);
  const opener = useRef(null as HTMLElement | null);
  const dismissed = useRef(false);
  const titleId = useId();

  const show = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dismissed.current = false;
    dialog.showModal();
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  const onClose = () => {
    const dialog = ref.current;
    if (!dialog) return;
    if (dismissed.current) {
      if (opener.current?.isConnected) opener.current.focus();
      return;
    }
    // A second Esc closes a native dialog even when cancel was prevented, so open it again.
    if (!dialog.open) dialog.showModal();
  };

  const dismiss = () => {
    dismissed.current = true;
    ref.current?.close();
  };

  return (
    <CrisisContext.Provider value={api}>
      {children}
      <dialog ref={ref} className="crisis" aria-labelledby={titleId} onCancel={(e) => e.preventDefault()} onClose={onClose}>
        <h2 id={titleId} className="mt-0">
          {CRISIS.title}
        </h2>
        <p>{CRISIS.text}</p>
        <div className="grid gap-3">
          <ButtonLink kind="primary" href="tel:988" block>
            {CRISIS.call988}
          </ButtonLink>
          <ButtonLink kind="secondary" href="sms:988" block>
            {CRISIS.text988}
          </ButtonLink>
          <ButtonLink kind="secondary" href="tel:911" block>
            {CRISIS.call911}
          </ButtonLink>
          <Button kind="tertiary" block onClick={dismiss}>
            {CRISIS.understand}
          </Button>
        </div>
      </dialog>
    </CrisisContext.Provider>
  );
}
