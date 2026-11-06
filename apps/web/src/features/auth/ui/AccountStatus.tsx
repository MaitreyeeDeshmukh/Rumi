"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "../AuthProvider";
import { AUTH_COPY } from "./copy";
import { S } from "./styles";

/**
 * Who is using Rumi: "Signed in as <email>" with a Sign out button, or "Guest" with links to log in and sign up.
 * Mount it once in the header or footer. It shows nothing until the browser has looked for a session, so it never flashes the wrong state.
 * With `showGuest={false}` it only shows for a signed-in account (the log-in and sign-up pages use that).
 */
export function AccountStatus({ showGuest = true }: { showGuest?: boolean }) {
  const auth = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (auth.status === "signing_in") return null;

  if (auth.email !== null && !auth.isAnonymous) {
    return (
      <div className={S.account}>
        <span>{AUTH_COPY.account.signedInAs(auth.email)}</span>
        <button
          type="button"
          className={S.toggle}
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void auth.signOut().finally(() => setSigningOut(false));
          }}
        >
          {AUTH_COPY.account.signOut}
        </button>
      </div>
    );
  }

  if (!showGuest) return null;
  return (
    <div className={S.account}>
      <span>{AUTH_COPY.account.guest}</span>
      <Link href="/login" className={S.link}>
        {AUTH_COPY.account.logIn}
      </Link>
      <Link href="/signup" className={S.link}>
        {AUTH_COPY.account.signUp}
      </Link>
    </div>
  );
}
