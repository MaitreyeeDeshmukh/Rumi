"use client";

// swap when the lane merges: mount the lane's RumiProvider instead (see src/lib/rumiActive.ts).
import { useEffect, type ReactNode } from "react";
import { refreshFromStorage } from "@/features/shims/useRumi.shim";
import { STORAGE_KEY } from "@/lib/rumiStore";

/** Keeps every open tab of Rumi in step: when another tab writes rumi.v1, this one reads it again. */
export function RumiShimProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === STORAGE_KEY) refreshFromStorage();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return children;
}
