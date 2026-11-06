"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../AuthProvider";
import { AUTH_COPY } from "./copy";
import { S } from "./styles";

/**
 * Where the confirmation email link returns to. The browser client reads the code in the address and signs the person in
 * (AuthProvider waits for that before it reports a state), so this page only shows what happened and then moves on.
 */
export function ConfirmStatus({ next }: { next: string }) {
  const auth = useAuth();
  const router = useRouter();
  const confirmed = auth.status === "ready" && !auth.isAnonymous;

  useEffect(() => {
    if (!confirmed) return;
    // A short pause so the status can be read; the Continue link below works at once.
    const timer = setTimeout(() => router.replace(next), 2500);
    return () => clearTimeout(timer);
  }, [confirmed, next, router]);

  if (auth.status === "signing_in") {
    return (
      <p role="status" className={S.top6}>
        {AUTH_COPY.confirm.checking}
      </p>
    );
  }
  if (confirmed) {
    return (
      <div className={`${S.top6} ${S.gap3}`}>
        <p role="status" className={S.status}>
          {AUTH_COPY.confirm.done}
        </p>
        <Link href={next} className={S.primary}>
          {AUTH_COPY.confirm.continue}
        </Link>
      </div>
    );
  }
  return (
    <div className={`${S.top6} ${S.gap3}`}>
      <p role="alert" className={S.notice}>
        {AUTH_COPY.confirm.failed}
      </p>
      <Link href="/login" className={S.primary}>
        {AUTH_COPY.confirm.toLogin}
      </Link>
    </div>
  );
}
