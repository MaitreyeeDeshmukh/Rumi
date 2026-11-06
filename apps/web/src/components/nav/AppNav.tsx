"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { APP_NAV, SAY_IT } from "@/components/nav/appNavItems";
import { Logo } from "@/components/nav/Logo";
import { cn } from "@/components/ui/cn";
import { NAV } from "@/content/nav";
import { INFO_LINKS } from "@/lib/site";

// The active item has a fill, a coloured bar and an underline, so it still stands out when colours are forced.
// Inactive items have no border at all (a transparent border would show in forced colors); padding keeps the size.
const current =
  "aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary aria-[current=page]:underline aria-[current=page]:underline-offset-4";

/** Bottom tabs under 1024 px, a left sidebar from 1024 px. Two navs; CSS shows one, so the other leaves the page tree. */
export function AppNav() {
  const pathname = usePathname();
  const bar = useRef(null as HTMLDivElement | null);

  // Tells the page how much room the bar needs (text size can make it taller). Writes a CSS variable, no state.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => {
      if (el.offsetHeight > 0) root.style.setProperty("--tabbar-h", `${el.offsetHeight}px`);
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--tabbar-h");
    };
  }, []);

  const page = (href: string) => (pathname === href ? "page" : undefined);

  return (
    <>
      <nav
        aria-label={NAV.appLabel}
        className="no-print fixed inset-x-0 bottom-0 z-[var(--z-nav)] bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <div ref={bar} className="mx-auto grid max-w-2xl grid-cols-5 border-t border-line">
          {APP_NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={page(href)}
              className={cn(
                "flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0 pt-[3px] text-center text-[min(.75rem,12px)] leading-tight font-bold whitespace-nowrap text-ink no-underline aria-[current=page]:border-t-[3px] aria-[current=page]:border-primary aria-[current=page]:pt-0",
                current,
              )}
            >
              <Icon aria-hidden="true" className="size-6" />
              <span data-tab-label>{label}</span>
            </Link>
          ))}
        </div>
      </nav>

      <nav
        aria-label={NAV.appLabel}
        className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-3 self-start border-r border-line p-4 lg:flex"
      >
        {/* Logo and Urgent help stay in view at any window height; only the links below scroll. */}
        <div className="grid shrink-0 justify-items-start gap-2">
          <Logo />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {[...APP_NAV, SAY_IT].map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={page(href)}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-control pr-3 pl-[calc(.75rem+3px)] font-bold text-ink no-underline hover:bg-lav aria-[current=page]:border-l-[3px] aria-[current=page]:border-primary aria-[current=page]:pl-3",
                current,
              )}
            >
              <Icon aria-hidden="true" className="size-5" />
              {label}
            </Link>
          ))}
          <div role="group" aria-labelledby="app-help-info" className="mt-4">
            <p id="app-help-info" className="mb-1 px-3 text-sm font-bold text-muted-ink">
              {NAV.helpAndInfo}
            </p>
            {INFO_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex min-h-11 items-center rounded-control px-3 text-ink hover:bg-lav"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
    </>
  );
}
