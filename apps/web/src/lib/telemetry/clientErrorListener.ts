import { reportClientError } from "./reportClientError";

/** One page load may send this many reports from the listener, so a loop of failures cannot flood /api/client-error. */
export const MAX_LISTENER_REPORTS = 3;

/** The part of `window` the listener needs, so a test can hand it a fake. */
export interface ErrorEventTarget {
  addEventListener(type: "unhandledrejection" | "error", listener: (event: unknown) => void): void;
  removeEventListener(type: "unhandledrejection" | "error", listener: (event: unknown) => void): void;
}

let sent = 0;

/** Tests only: a new page load. */
export function resetListenerBudget(): void {
  sent = 0;
}

/** Only the digest Next.js puts on an error is read. The message and stack are never touched. */
function digestOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("digest" in value)) return undefined;
  const digest = (value as { digest: unknown }).digest;
  return typeof digest === "string" ? digest : undefined;
}

/**
 * Reports an unhandled promise rejection or an uncaught script error as `unhandled_rejection`: the code, the page path
 * and the digest when there is one. At most MAX_LISTENER_REPORTS per page load. Returns a function that removes the listeners.
 */
export function listenForClientErrors(target: ErrorEventTarget, report: typeof reportClientError = reportClientError): () => void {
  const handle = (value: unknown): void => {
    if (sent >= MAX_LISTENER_REPORTS) return;
    sent += 1;
    report("unhandled_rejection", digestOf(value));
  };
  const onRejection = (event: unknown): void => handle(typeof event === "object" && event !== null ? (event as { reason?: unknown }).reason : undefined);
  const onError = (event: unknown): void => handle(typeof event === "object" && event !== null ? (event as { error?: unknown }).error : undefined);
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener("error", onError);
  return () => {
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("error", onError);
  };
}
