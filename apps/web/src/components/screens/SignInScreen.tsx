"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { SIGN_IN } from "@/content/signIn";
import { useAuth } from "@/features/auth/AuthProvider";

/** Short-lived, path-limited cookie that carries the return path across the email link (the link itself stays a plain /auth/callback). */
const NEXT_COOKIE = "rumi_next";

/** /sign-in: one email field. The answer is the same for a new and an existing address. */
export function SignInScreen({ next, linkProblem }: { next: string | null; linkProblem: boolean }) {
  const id = useId();
  const router = useRouter();
  const { signInWithEmail, status, isAnonymous } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Someone who already has an email session has nothing to do here.
  useEffect(() => {
    if (status === "ready" && !isAnonymous) router.replace(next ?? "/home");
  }, [status, isAnonymous, next, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    if (next) document.cookie = `${NEXT_COOKIE}=${encodeURIComponent(next)}; path=/auth; max-age=600; samesite=lax`;
    const result = await signInWithEmail(email);
    setBusy(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    setSent(false);
    setError(result.message);
    input.current?.focus();
  };

  return (
    <Screen title={SIGN_IN.title} lead={SIGN_IN.lead}>
      <div data-needs-js className="grid max-w-xl gap-4">
        {linkProblem && !sent ? <Notice tone="warn">{SIGN_IN.linkProblem}</Notice> : null}
        <form onSubmit={submit} noValidate className="grid gap-4">
          <Field id={`${id}-email`} label={SIGN_IN.emailLabel} hint={SIGN_IN.emailHint} error={error || undefined}>
            <input
              ref={input}
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              className={fieldControlClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <div>
            <Button kind="primary" type="submit" loading={busy} loadingLabel={SIGN_IN.sending}>
              {SIGN_IN.button}
            </Button>
          </div>
        </form>
        <div role="status" aria-live="polite" className="min-h-6">
          {sent ? (
            <Notice tone="success">
              <p>{SIGN_IN.sent}</p>
              <p>{SIGN_IN.sentLater}</p>
            </Notice>
          ) : null}
        </div>
        <p className="note m-0">{SIGN_IN.noPassword}</p>
      </div>
    </Screen>
  );
}
