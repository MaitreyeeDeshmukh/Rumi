import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Check } from "@/components/ui/icons";

/** A page section with its h2. The id ties the heading to the section for screen readers. */
export function Section({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("mt-12", className)}>
      <h2 id={id} className="mt-0 mb-3 text-[1.4rem]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Short statements with a check icon and the words, so the meaning is never only the icon. */
export function CheckList({ items }: { items: readonly string[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="m-0 mb-4 grid list-disc gap-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Buttons side by side on wide screens, stacked and full width on phones. */
export function Actions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center", className)}>{children}</div>
  );
}
