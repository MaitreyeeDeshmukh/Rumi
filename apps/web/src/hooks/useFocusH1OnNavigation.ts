"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { navStore } from "@/lib/nav";

/** After a client navigation, move focus to the page's h1. On the first page load do nothing, so Tab starts at the skip link. */
export function useFocusH1OnNavigation(): void {
  const pathname = usePathname();
  useEffect(() => {
    if (navStore.getSnapshot().count === 0) return;
    const h1 = document.querySelector<HTMLElement>("main h1");
    if (!h1) return;
    if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
    h1.focus();
  }, [pathname]);
}
