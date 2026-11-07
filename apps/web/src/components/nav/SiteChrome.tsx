import type { ReactNode } from "react";
import Link from "next/link";
import { BackRow } from "@/components/nav/BackRow";
import { FocusOnNavigate } from "@/components/nav/FocusOnNavigate";
import { SiteFooter } from "@/components/nav/SiteFooter";
import { SiteHeader } from "@/components/nav/SiteHeader";
import { NAV } from "@/content/nav";
import { MAIN_NAV } from "@/lib/site";

/** Header, main (Back row first), footer. Used by the (site) layout, not-found and error. */
export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <noscript>
        <nav aria-label={NAV.noscriptLabel} className="border-b border-line px-4 py-2 lg:hidden">
          <ul className="m-0 flex list-none flex-wrap gap-x-4 p-0">
            {MAIN_NAV.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center font-bold text-ink">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </noscript>
      <main id="main" tabIndex={-1} data-wide>
        <BackRow />
        <FocusOnNavigate />
        <div className="page-enter">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
