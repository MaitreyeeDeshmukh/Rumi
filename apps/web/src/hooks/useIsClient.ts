"use client";

import { useSyncExternalStore } from "react";

/** False during server rendering and hydration, true afterwards. Avoids setState in an effect. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
