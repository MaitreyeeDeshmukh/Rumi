"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../AuthProvider";
import { EMAIL_COOLDOWN_MS } from "../authController";
import { AUTH_COPY } from "./copy";
import { S } from "./styles";

/** Whole seconds left until `from + 60 s` (never below zero). */
export const secondsLeft = (from: number, now: number): number => Math.max(0, Math.ceil((from + EMAIL_COOLDOWN_MS - now) / 1000));

/** Seconds left of the 60 second wait, counted down once a second. Zero means the button may be used. */
export function useCooldown(from: number): { left: number; restart: () => void } {
  const [start, setStart] = useState(from);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return {
    left: secondsLeft(start, now),
    restart: () => {
      setStart(Date.now());
      setNow(Date.now());
    },
  };
}

/** Sends the confirmation (or reset) code again, at most once a minute. The count starts when the page is shown, because the code was just sent. */
export function ResendButton({ email, recovery = false }: { email: string; recovery?: boolean }) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const { left, restart } = useCooldown(mountedAt);

  async function resend(): Promise<void> {
    if (pending || left > 0) return;
    setPending(true);
    setNote(null);
    const result = await (recovery ? auth.requestPasswordReset(email) : auth.resendConfirmation(email));
    setPending(false);
    if (result.ok) restart();
    setNote(result.ok ? { text: AUTH_COPY.code.resent, ok: true } : { text: result.message, ok: false });
  }

  return (
    <div className={S.gap2}>
      <button type="button" className={S.secondary} onClick={() => void resend()} disabled={pending || left > 0}>
        {pending ? AUTH_COPY.code.resending : left > 0 ? AUTH_COPY.code.wait(left) : AUTH_COPY.code.resend}
      </button>
      <p role="status" className={note?.ok === false ? S.fieldError : undefined}>
        {note?.text}
      </p>
    </div>
  );
}
