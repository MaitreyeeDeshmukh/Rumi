"use client";

import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../AuthProvider";
import { cleanCode, isValidCode } from "../authController";
import { CodeField } from "./CodeField";
import { AUTH_COPY } from "./copy";
import { ErrorRegion } from "./parts";
import { ResendButton } from "./ResendButton";
import { S } from "./styles";

/** Step 2 of sign-up: type the code from the email. `onDone` runs once the account is confirmed and signed in. The text is the same for a new address and for one that already has an account. */
export function VerifyCode({ email, onDone, onBack }: { email: string; onDone: () => void; onBack: () => void }) {
  const auth = useAuth();
  const codeRef = useRef<HTMLInputElement>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<{ text: string; tick: number } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const code = cleanCode(String(new FormData(event.currentTarget).get("code") ?? ""));
    setServerError(null);
    setFieldError(isValidCode(code) ? null : AUTH_COPY.code.short);
    if (!isValidCode(code)) return codeRef.current?.focus();
    setPending(true);
    const result = await auth.verifyEmailCode(email, code, "signup");
    setPending(false);
    if (result.ok) return onDone();
    setServerError({ text: result.message, tick: Date.now() });
  }

  return (
    <section aria-labelledby="verify-title" className={`${S.top6} ${S.gap4}`}>
      <h2 id="verify-title" className={S.flush}>
        {AUTH_COPY.code.title}
      </h2>
      <p className={S.notice}>{AUTH_COPY.code.body(email)}</p>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className={S.form}>
        <ErrorRegion message={serverError?.text ?? null} tick={serverError?.tick ?? 0} />
        <CodeField id="signup-code" error={fieldError} inputRef={codeRef} />
        <button type="submit" className={S.primary} disabled={pending}>
          {pending ? AUTH_COPY.code.pending : AUTH_COPY.code.submit}
        </button>
      </form>
      <ResendButton email={email} />
      <button type="button" className={S.toggle} onClick={onBack}>
        {AUTH_COPY.code.wrongEmail}
      </button>
    </section>
  );
}
