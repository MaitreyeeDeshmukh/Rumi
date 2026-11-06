"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { isAppRoute } from "@/lib/nav";
import { shouldStick } from "@/lib/sticky";

/**
 * Wraps the primary action group. Sticks above the tab bar on app phones; static on the site, on wide screens,
 * with the keyboard open, or when it would cover too much. It sits in the page flow, so it reserves its own height.
 */
export function StickyActions({ children }: { children: ReactNode }) {
  const isApp = isAppRoute(usePathname());
  const el = useRef(null as HTMLDivElement | null);

  const subscribe = useCallback((notify: () => void) => {
    const node = el.current;
    const observer = node ? new ResizeObserver(notify) : null;
    if (node) observer?.observe(node);
    window.addEventListener("resize", notify);
    window.visualViewport?.addEventListener("resize", notify);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", notify);
      window.visualViewport?.removeEventListener("resize", notify);
    };
  }, []);

  const sticky = useSyncExternalStore(
    subscribe,
    () =>
      shouldStick({
        width: window.innerWidth,
        innerHeight: window.innerHeight,
        visualViewportHeight: window.visualViewport?.height ?? window.innerHeight,
        stickyHeight: el.current?.offsetHeight ?? 0,
        isApp,
      }),
    () => false,
  );

  // While the bar sticks it covers the bottom of the screen: tell the page how much (--sticky-h, no state).
  useEffect(() => {
    const node = el.current;
    if (!node || !sticky) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--sticky-h", `${node.offsetHeight}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--sticky-h");
    };
  }, [sticky]);

  return (
    <div ref={el} className="sticky-actions no-print" data-sticky={sticky ? "true" : "false"}>
      {children}
    </div>
  );
}
