"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../AuthProvider";
import { AUTH_MESSAGES, isValidEmail, normalizeEmail } from "../authController";
import { AUTH_COPY } from "./copy";
import { ErrorRegion, TextField } from "./parts";
import { S } from "./styles";

/** Asks for a reset link. Every well-formed address gets the same answer, so the page cannot be used to find out who has an account. */
export function ForgotPasswordForm() {
  const auth = useAuth();
  const emailRef = useRef<HTMLInputElement>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<{ text: string; tick: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const email = normalizeEmail(String(new FormData(event.currentTarget).get("email") ?? ""));
    const problem = email.length === 0 ? AUTH_MESSAGES.emailEmpty : isValidEmail(email) ? null : AUTH_MESSAGES.emailInvalid;
    setFieldError(problem);
    setServerError(null);
    if (problem !== null) return emailRef.current?.focus();
    setPending(true);
    const result = await auth.requestPasswordReset(email);
    setPending(false);
    if (result.ok) setDone(true);
    else setServerError({ text: result.message, tick: Date.now() });
  }

  return (
    <>
      {done ? (
        <p role="status" className={`${S.status} ${S.top6}`}>
          {AUTH_COPY.forgot.done}
        </p>
      ) : null}
      <form method="post" action="/forgot-password" noValidate onSubmit={(e) => void onSubmit(e)} className={S.form}>
        <ErrorRegion message={serverError?.text ?? null} tick={serverError?.tick ?? 0} />
        <TextField id="forgot-email" name="email" label={AUTH_COPY.fields.email} autoComplete="email" error={fieldError} inputRef={emailRef} />
        <button type="submit" className={S.primary} disabled={pending}>
          {pending ? AUTH_COPY.forgot.pending : AUTH_COPY.forgot.submit}
        </button>
      </form>
      <div className={S.links}>
        <Link href="/login" className={S.link}>
          {AUTH_COPY.forgot.backToLogin}
        </Link>
      </div>
    </>
  );
}
