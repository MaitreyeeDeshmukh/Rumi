import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** A small label. It is not a control, so it is tinted with lav and never uses a purple fill. */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border border-line bg-lav px-3 text-sm font-semibold text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}
