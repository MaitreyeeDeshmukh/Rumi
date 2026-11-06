"use client";

import { useEffect, type RefObject } from "react";

/**
 * While the call screen is up, everything else in the document body is `inert`: the app bar, main, tabs and sidebar,
 * and the skip link. Tab and screen readers cannot reach them. The call screen itself and the crisis dialog stay live.
 * Layers that open later (sheets) are not touched here; they manage the page behind them themselves.
 */
export function useInertShell(layer: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const own = layer.current;
    const covered = [...document.body.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        el !== own &&
        !el.inert &&
        !["DIALOG", "SCRIPT", "STYLE", "NEXT-ROUTE-ANNOUNCER"].includes(el.tagName),
    );
    for (const el of covered) el.inert = true;
    return () => {
      for (const el of covered) el.inert = false;
    };
  }, [layer]);
}
