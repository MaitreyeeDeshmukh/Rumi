"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { OpenRumiButton } from "@/components/nav/OpenRumiButton";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import { NAV } from "@/content/nav";
import { useIsClient } from "@/hooks/useIsClient";
import { MAIN_NAV } from "@/lib/site";

/** The Menu button and its sheet, for widths under 1024 px. Without JavaScript it is not rendered; before hydration an empty slot keeps its space. */
export function MenuSheet() {
  const pathname = usePathname();
  const isClient = useIsClient();
  const [state, setState] = useState({ open: false, path: pathname });
  // A new route closes the sheet. This adjusts state while rendering, which React allows, instead of in an effect.
  if (state.path !== pathname) setState({ open: false, path: pathname });
  // Before the page is interactive an invisible copy of the button keeps its exact space, so the header does not grow.
  if (!isClient) {
    return (
      <Button kind="secondary" chrome aria-hidden="true" tabIndex={-1} data-menu-slot="" data-needs-script className="invisible lg:hidden">
        <Menu aria-hidden="true" className="size-5" />
        {NAV.menu}
      </Button>
    );
  }

  const setOpen = (open: boolean) => setState({ open, path: pathname });
  return (
    <>
      <Button kind="secondary" chrome className="lg:hidden" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Menu aria-hidden="true" className="size-5" />
        {NAV.menu}
      </Button>
      <Sheet open={state.open} onOpenChange={setOpen} title={NAV.menuTitle}>
        <nav aria-label={NAV.mainLabel}>
          <ul className="m-0 grid list-none p-0">
            {MAIN_NAV.map((l) => (
              <li key={l.href} className="border-b border-line">
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-[56px] items-center text-lg font-bold text-ink no-underline hover:text-primary"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <OpenRumiButton kind="primary" block />
      </Sheet>
    </>
  );
}
