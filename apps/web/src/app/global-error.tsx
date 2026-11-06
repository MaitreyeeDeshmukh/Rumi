"use client";

import { useEffect } from "react";
import { CRISIS } from "@/content/crisis";
import { NAV } from "@/content/nav";
import { ERROR_PAGE } from "@/content/pages";
import { SITE } from "@/lib/site";
import { reportClientError } from "@/lib/telemetry/reportClientError";

// The router and every layout are unavailable here, so this page uses plain elements and inline styles.
const control = { display: "inline-block", minHeight: 44, padding: "10px 16px", marginRight: 12, marginBottom: 12 } as const;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // Only the digest is sent: never the message or stack.
  useEffect(() => reportClientError("global_error", error.digest), [error]);
  return (
    <html lang="en">
      <head>
        <title>{`${ERROR_PAGE.title} | ${SITE.name}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 560, margin: "0 auto", lineHeight: 1.5 }}>
        <main id="main">
          {/* Plain anchors on purpose: the router is unavailable when the root layout fails. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={control}>
            {NAV.back}
          </a>
          <h1 tabIndex={-1}>{ERROR_PAGE.h1}</h1>
          <p>{ERROR_PAGE.lead}</p>
          <p>
            <button type="button" style={control} onClick={() => reset()}>
              {NAV.tryAgain}
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={control}>
              {NAV.goHome}
            </a>
          </p>
          <p>
            <a href="tel:988" style={control}>
              {CRISIS.call988}
            </a>
            <a href="tel:911" style={control}>
              {CRISIS.call911}
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
