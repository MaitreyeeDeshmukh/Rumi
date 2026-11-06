"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { navStore } from "@/lib/nav";

export function useNavStack(): readonly string[] {
  return useSyncExternalStore(navStore.subscribe, () => navStore.getSnapshot().stack, () => navStore.getServerSnapshot().stack);
}

function NavTracker(): null {
  const pathname = usePathname();
  useEffect(() => {
    navStore.record(pathname);
  }, [pathname]);
  return null;
}

/** NavTracker comes first so it records before any later effect (such as the focus hook) reads the count. */
export function NavHistoryProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <NavTracker />
      {children}
    </>
  );
}
