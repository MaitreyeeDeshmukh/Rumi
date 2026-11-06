export type StickyInput = {
  width: number;
  innerHeight: number;
  visualViewportHeight: number;
  stickyHeight: number;
  isApp: boolean;
};

/** Stick only in the app, under 1024 px, with no on-screen keyboard, and when the bar covers at most a third of the screen. */
export function shouldStick(i: StickyInput): boolean {
  return (
    i.isApp &&
    i.width < 1024 &&
    i.visualViewportHeight / i.innerHeight >= 0.75 &&
    i.stickyHeight <= i.innerHeight / 3
  );
}
