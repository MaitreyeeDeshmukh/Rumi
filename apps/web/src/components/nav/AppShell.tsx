"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { AppNav } from "@/components/nav/AppNav";
import { BackRow } from "@/components/nav/BackRow";
import { cn } from "@/components/ui/cn";
import { FocusOnNavigate } from "@/components/nav/FocusOnNavigate";

/**
 * Bar, nav, main (Back row first) and the footer of the app. `/welcome` has no tabs or sidebar, so its bar shows
 * at every width (it holds the logo and Urgent help). Elsewhere the bar shows under 1024 px; the sidebar has both.
 * The bar is sticky so Urgent help is always on screen.
 */
export function AppShell({
  bar,
  noJs,
  footer,
  children,
}: {
  bar: ReactNode;
  noJs: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  const welcome = path === "/welcome";
  // The dashboard uses the room beside the sidebar; every other screen keeps the readable width.
  const wide = path === "/home";
  const barBox = useRef(null as HTMLDivElement | null);

  // The bar stays at the top of the screen on phones, so focus and anchors need that much room: --appbar-h (no state).
  useEffect(() => {
    const el = barBox.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--appbar-h", `${el.offsetHeight}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--appbar-h");
    };
  }, []);

  return (
    <>
      <div ref={barBox} className={cn("sticky top-0 z-[var(--z-nav)] bg-bg", welcome ? undefined : "lg:hidden")}>
        {bar}
      </div>
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        {welcome ? null : <AppNav />}
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            id="main"
            tabIndex={-1}
            data-no-tabs={welcome ? "" : undefined}
            className={wide ? "lg:px-8" : undefined}
            style={wide ? ({ "--main-max": "84rem" } as CSSProperties) : undefined}
          >
            <BackRow />
            <FocusOnNavigate />
            {noJs}
            {children}
            {footer}
          </main>
        </div>
      </div>
    </>
  );
}
