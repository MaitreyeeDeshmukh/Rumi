"use client";

/**
 * Browser side of /api/client-error. Sends the fixed code, the page path and Next's error digest. It never reads
 * error.message or error.stack, and it never throws: a failed report must not make a broken page worse.
 */
export function reportClientError(code: "render_error" | "global_error" | "unhandled_rejection" | "ensure_rows_failed", digest?: string): void {
  try {
    const body: { code: string; route: string; fingerprint?: string } = { code, route: window.location.pathname.slice(0, 80) };
    if (digest !== undefined && /^[a-z0-9]{8,64}$/.test(digest)) body.fingerprint = digest;
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // Reporting is best effort. Logging here would only loop if the network is the thing that broke.
    });
  } catch {
    // `window` or `fetch` missing (very old browser, or a test): nothing to report with.
  }
}
