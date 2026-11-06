// The one history entry the practice call screen adds (spec 4.4). Browser Back then lands on the call screen's own
// listener instead of leaving the page. Every in-app exit takes the entry off again, so no stray entry is left.

export const markerOnTop = (): boolean => (window.history.state as { rumiCall?: boolean } | null)?.rumiCall === true;

/** Adds the marker unless it is already the top entry (so a second call never stacks two). */
export function pushMarker(): void {
  if (!markerOnTop()) window.history.pushState({ rumiCall: true }, "");
}

/**
 * Removes the marker if it is on top, waits for the popstate that causes, then runs `done` once.
 * Without a marker, `done` runs at once. The caller removes its own popstate listener first.
 */
export function popMarker(done: () => void): void {
  if (!markerOnTop()) {
    done();
    return;
  }
  let called = false;
  const finish = () => {
    if (called) return;
    called = true;
    window.removeEventListener("popstate", finish);
    window.clearTimeout(timer);
    done();
  };
  window.addEventListener("popstate", finish);
  // ponytail: safety net when a browser never reports the popstate; one second, then go on anyway
  const timer = window.setTimeout(finish, 1000);
  window.history.back();
}
