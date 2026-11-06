"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../AuthProvider";
import { checkCredentials, type CredentialErrors } from "../authController";
import { AccountStatus } from "./AccountStatus";
import { CheckEmail } from "./CheckEmail";
import { AUTH_COPY } from "./copy";
import { googleAuthEnabled } from "./flags";
import { ErrorRegion, PasswordField, TextField } from "./parts";
import { ResendButton } from "./ResendButton";
import { S } from "./styles";

export type AuthMode = "login" | "signup";

const withNext = (path: string, next: string): string => (next === "/" ? path : `${path}?next=${encodeURIComponent(next)}`);

/** The log-in and sign-up form. `next` is already checked by safeNextPath on the server. */
export function AuthForm({ mode, next }: { mode: AuthMode; next: string }) {
  const auth = useAuth();
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<CredentialErrors>({ email: null, password: null });
  const [serverError, setServerError] = useState<{ text: string; tick: number; unconfirmed: boolean } | null>(null);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [lastEmail, setLastEmail] = useState("");
  const copy = AUTH_COPY[mode];
  const isLogin = mode === "login";
  const guest = auth.status === "ready" && auth.isAnonymous;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    // Read from the form, not from state, so the password is never kept by this component.
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const found = checkCredentials(email, password, mode);
    setErrors(found);
    setServerError(null);
    setLastEmail(email.trim().toLowerCase());
    if (found.email !== null) return emailRef.current?.focus();
    if (found.password !== null) return passwordRef.current?.focus();
    setPending(true);
    const result = await (isLogin ? auth.signInWithPassword(email, password) : auth.signUpWithPassword(email, password));
    setPending(false);
    if (!result.ok) {
      setServerError({ text: result.message, tick: Date.now(), unconfirmed: result.unconfirmed === true });
      return;
    }
    if (result.needsConfirmation) return setSentTo(email.trim().toLowerCase());
    router.replace(next);
  }

  async function onGoogle(): Promise<void> {
    setServerError(null);
    const result = await auth.signInWithGoogle();
    if (!result.ok) setServerError({ text: result.message, tick: Date.now(), unconfirmed: false });
  }

  const otherHref = withNext(isLogin ? "/signup" : "/login", next);

  if (sentTo !== null) return <CheckEmail email={sentTo} loginHref={withNext("/login", next)} />;

  return (
    <>
      <AccountStatus showGuest={false} />
      {isLogin && guest ? <p className={`${S.notice} ${S.top4}`}>{AUTH_COPY.login.guestWarning}</p> : null}
      {!isLogin && guest ? <p className={`${S.notice} ${S.top4}`}>{AUTH_COPY.signup.guestKept}</p> : null}
      {/* method="post" keeps a password out of the address bar if the form is ever sent before this script has loaded. */}
      <form method="post" action={isLogin ? "/login" : "/signup"} noValidate onSubmit={(e) => void onSubmit(e)} className={S.form}>
        <ErrorRegion message={serverError?.text ?? null} tick={serverError?.tick ?? 0} />
        {serverError?.unconfirmed && lastEmail ? (
          <div className={S.gap2}>
            <p>{AUTH_COPY.login.unconfirmedHelp}</p>
            <ResendButton email={lastEmail} />
          </div>
        ) : null}
        <TextField id={`${mode}-email`} name="email" label={AUTH_COPY.fields.email} autoComplete="email" error={errors.email} inputRef={emailRef} />
        <PasswordField
          id={`${mode}-password`}
          label={AUTH_COPY.fields.password}
          autoComplete={isLogin ? "current-password" : "new-password"}
          error={errors.password}
          hint={isLogin ? undefined : AUTH_COPY.fields.passwordHint}
          inputRef={passwordRef}
          visible={visible}
          onToggle={() => setVisible((v) => !v)}
        />
        <button type="submit" className={S.primary} disabled={pending}>
          {pending ? copy.pending : copy.submit}
        </button>
        {googleAuthEnabled() ? (
          <>
            <p className={S.divider}>{AUTH_COPY.shared.or}</p>
            <button type="button" className={S.secondary} onClick={() => void onGoogle()}>
              {AUTH_COPY.shared.google}
            </button>
          </>
        ) : null}
      </form>
      <div className={S.links}>
        {isLogin ? (
          <Link href="/forgot-password" className={S.link}>
            {AUTH_COPY.login.forgot}
          </Link>
        ) : null}
        <Link href={otherHref} className={S.link}>
          {isLogin ? AUTH_COPY.login.toSignup : AUTH_COPY.signup.toLogin}
        </Link>
        <Link href="/" className={S.link}>
          {AUTH_COPY.shared.guestLink}
        </Link>
      </div>
    </>
  );
}
