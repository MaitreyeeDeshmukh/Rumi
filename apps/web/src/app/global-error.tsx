"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/telemetry/reportClientError";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // Only the digest is sent: never the message or stack.
  useEffect(() => reportClientError("global_error", error.digest), [error]);
  return (
    <html lang="en">
      <head>
        <title>Something went wrong | Rumi</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 560, margin: "0 auto" }}>
        <h1>Something went wrong</h1>
        <p>We couldn&apos;t load Rumi. Please reload the page. If this keeps happening, try again in a few minutes.</p>
        {/* Plain anchor on purpose: the router is unavailable when the root layout fails. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/">Go to Home</a>
      </body>
    </html>
  );
}
