"use client";

import { useState } from "react";
import { useAuth } from "../AuthProvider";
import { AUTH_COPY } from "./copy";
import { S } from "./styles";

/** Sends the confirmation email again. The controller allows one per minute per device and says so in a sentence. */
export function ResendButton({ email }: { email: string }) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  async function resend(): Promise<void> {
    if (pending) return;
    setPending(true);
    setNote(null);
    const result = await auth.resendConfirmation(email);
    setPending(false);
    setNote(result.ok ? { text: AUTH_COPY.checkEmail.resent, ok: true } : { text: result.message, ok: false });
  }

  return (
    <div className={S.gap2}>
      <button type="button" className={S.secondary} onClick={() => void resend()} disabled={pending}>
        {pending ? AUTH_COPY.checkEmail.resending : AUTH_COPY.checkEmail.resend}
      </button>
      <p role="status" className={note?.ok === false ? S.fieldError : undefined}>
        {note?.text}
      </p>
    </div>
  );
}
