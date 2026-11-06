"use client";

import Link from "next/link";
import { AUTH_COPY } from "./copy";
import { ResendButton } from "./ResendButton";
import { S } from "./styles";

/** Shown after sign-up when the person must follow a link first. The same text appears for a new address and for one that already has an account. */
export function CheckEmail({ email, loginHref }: { email: string; loginHref: string }) {
  return (
    <section aria-labelledby="check-email-title" className={`${S.top6} ${S.gap4}`}>
      <h2 id="check-email-title" className={S.flush}>
        {AUTH_COPY.checkEmail.title}
      </h2>
      <p className={S.notice}>
        {AUTH_COPY.checkEmail.body(email)} {AUTH_COPY.checkEmail.next}
      </p>
      <ResendButton email={email} />
      <Link href={loginHref} className={S.link}>
        {AUTH_COPY.checkEmail.backToLogin}
      </Link>
    </section>
  );
}
