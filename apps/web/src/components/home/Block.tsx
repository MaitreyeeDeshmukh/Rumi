import { useId, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** One dashboard block: a card with an h2. The id ties the heading to the section for screen readers. */
export function Block({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("rounded-card border border-line bg-surface p-5", className)}>
      <h2 id={id} className="mt-0 mb-2 text-[1.25rem]">
        {title}
      </h2>
      {children}
    </section>
  );
}
