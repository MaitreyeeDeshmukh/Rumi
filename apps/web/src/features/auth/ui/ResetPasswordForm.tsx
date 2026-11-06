"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../AuthProvider";
import { checkCredentials } from "../authController";
import { AUTH_COPY } from "./copy";
import { ErrorRegion, PasswordField } from "./parts";
import { S } from "./styles";

/**
 * The page the reset email links to. The link signs the person in (the browser client reads the code in the address); this form
 * then sets the new password. With no signed-in account (an old or missing link, or only a guest) it says so and links to /forgot-password.
 */
export function ResetPasswordForm() {
  const auth = useAuth();
  const router = useRouter();
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{ password: string | null; confirm: string | null }>({ password: null, confirm: null });
  const [serverError, setServerError] = useState<{ text: string; tick: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);

  if (auth.status === "signing_in") {
    return (
      <p role="status" className={S.top6}>
        {AUTH_COPY.reset.checking}
      </p>
    );
  }
  if (auth.status !== "ready" || auth.isAnonymous) {
    return (
      <div className={`${S.top6} ${S.gap3}`}>
        <p role="alert" className={S.notice}>
          {AUTH_COPY.reset.noSession}
        </p>
        <Link href="/forgot-password" className={S.secondary}>
          {AUTH_COPY.reset.askAgain}
        </Link>
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    const found = { password: checkCredentials("a@b.co", password, "signup").password, confirm: confirm === password ? null : AUTH_COPY.fields.mismatch };
    setErrors(found);
    setServerError(null);
    if (found.password !== null) return newRef.current?.focus();
    if (found.confirm !== null) return confirmRef.current?.focus();
    setPending(true);
    const result = await auth.updatePassword(password);
    setPending(false);
    if (!result.ok) return setServerError({ text: result.message, tick: Date.now() });
    router.replace("/");
  }

  return (
    <form method="post" action="/reset-password" noValidate onSubmit={(e) => void onSubmit(e)} className={S.form}>
      <ErrorRegion message={serverError?.text ?? null} tick={serverError?.tick ?? 0} />
      <PasswordField
        id="reset-password"
        label={AUTH_COPY.fields.newPassword}
        autoComplete="new-password"
        error={errors.password}
        hint={AUTH_COPY.fields.passwordHint}
        inputRef={newRef}
        visible={visible}
        onToggle={() => setVisible((v) => !v)}
      />
      <PasswordField id="reset-confirm" name="confirm" label={AUTH_COPY.fields.confirmPassword} autoComplete="new-password" error={errors.confirm} inputRef={confirmRef} visible={visible} />
      <button type="submit" className={S.primary} disabled={pending}>
        {pending ? AUTH_COPY.reset.pending : AUTH_COPY.reset.submit}
      </button>
    </form>
  );
}
