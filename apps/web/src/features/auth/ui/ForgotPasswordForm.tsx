"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../AuthProvider";
import { AUTH_MESSAGES, checkCredentials, cleanCode, isValidCode, isValidEmail, normalizeEmail } from "../authController";
import { CodeField } from "./CodeField";
import { AUTH_COPY } from "./copy";
import { ErrorRegion, PasswordField, TextField } from "./parts";
import { ResendButton } from "./ResendButton";
import { S } from "./styles";

/**
 * Two steps on one page. 1: ask for a code (every well-formed address gets the same answer, so the page cannot be used to
 * find out who has an account). 2: type the code and a new password; the person is then signed in and sent to /home.
 */
export function ForgotPasswordForm() {
  const auth = useAuth();
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<{ text: string; tick: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  // The code is checked once. If saving the password then fails, the next try only repeats the save (the code can be used once).
  const [verified, setVerified] = useState(false);

  async function onEmail(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const address = normalizeEmail(String(new FormData(event.currentTarget).get("email") ?? ""));
    const problem = address.length === 0 ? AUTH_MESSAGES.emailEmpty : isValidEmail(address) ? null : AUTH_MESSAGES.emailInvalid;
    setFieldError(problem);
    setServerError(null);
    if (problem !== null) return emailRef.current?.focus();
    setPending(true);
    const result = await auth.requestPasswordReset(address);
    setPending(false);
    if (result.ok) setEmail(address);
    else setServerError({ text: result.message, tick: Date.now() });
  }

  async function onReset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || email === null) return;
    const form = new FormData(event.currentTarget);
    const code = cleanCode(String(form.get("code") ?? ""));
    // Read from the form, not from state, so the password is never kept by this component.
    const password = String(form.get("password") ?? "");
    const codeProblem = verified || isValidCode(code) ? null : AUTH_COPY.code.short;
    const passwordProblem = checkCredentials(email, password, "signup").password;
    setCodeError(codeProblem);
    setPasswordError(passwordProblem);
    setServerError(null);
    if (codeProblem !== null) return codeRef.current?.focus();
    if (passwordProblem !== null) return passwordRef.current?.focus();
    setPending(true);
    if (!verified) {
      const checked = await auth.verifyEmailCode(email, code, "recovery");
      if (!checked.ok) {
        setPending(false);
        return setServerError({ text: checked.message, tick: Date.now() });
      }
      setVerified(true);
    }
    const saved = await auth.updatePassword(password);
    setPending(false);
    if (saved.ok) return router.replace("/home");
    setServerError({ text: saved.message, tick: Date.now() });
  }

  if (email !== null) {
    return (
      <section aria-labelledby="reset-title" className={`${S.top6} ${S.gap4}`}>
        <h2 id="reset-title" className={S.flush}>
          {AUTH_COPY.forgot.codeSubmit}
        </h2>
        <p className={S.notice}>{AUTH_COPY.forgot.codeIntro(email)}</p>
        <form noValidate onSubmit={(e) => void onReset(e)} className={S.form}>
          <ErrorRegion message={serverError?.text ?? null} tick={serverError?.tick ?? 0} />
          {verified ? null : <CodeField id="reset-code" error={codeError} inputRef={codeRef} />}
          <PasswordField
            id="reset-password"
            label={AUTH_COPY.fields.newPassword}
            autoComplete="new-password"
            error={passwordError}
            hint={AUTH_COPY.fields.passwordHint}
            inputRef={passwordRef}
            visible={visible}
            onToggle={() => setVisible((v) => !v)}
          />
          <button type="submit" className={S.primary} disabled={pending}>
            {pending ? AUTH_COPY.forgot.codePending : AUTH_COPY.forgot.codeSubmit}
          </button>
        </form>
        {verified ? null : <ResendButton email={email} recovery />}
        <button type="button" className={S.toggle} onClick={() => {
            setEmail(null);
            setVerified(false);
          }}>
          {AUTH_COPY.code.wrongEmail}
        </button>
      </section>
    );
  }

  return (
    <>
      <form method="post" action="/forgot-password" noValidate onSubmit={(e) => void onEmail(e)} className={S.form}>
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
