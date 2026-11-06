import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** A full-width strip for a fixed message such as the practice label. Tinted, never a button. */
export function Banner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("rounded-control border border-line bg-lav px-4 py-2 text-sm font-bold text-ink", className)}>
      {children}
    </div>
  );
}
