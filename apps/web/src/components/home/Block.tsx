import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** The soft colours of the theme, one per kind of block, so a block is told apart by more than its words. */
const TINT = { sage: "bg-sage", blue: "bg-blue", apricot: "bg-apricot", lav: "bg-lav" } as const;
export type Tint = keyof typeof TINT;

/** The small square that holds an icon. Decorative: the heading beside it names the block. */
export function IconBadge({ icon: Icon, tint }: { icon: LucideIcon; tint: Tint }) {
  return (
    <span aria-hidden="true" className={cn("grid size-11 shrink-0 place-items-center rounded-[14px] text-ink", TINT[tint])}>
      <Icon className="size-6" />
    </span>
  );
}

/** One dashboard block: a card with a heading and an optional icon. The id ties the heading to the section for screen readers. */
export function Block({
  title,
  icon,
  tint = "lav",
  level = 2,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  tint?: Tint;
  /** The heading level: 2 on the page, 3 inside the three steps. */
  level?: 2 | 3;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={id} className={cn("flex flex-col rounded-card border border-line bg-surface p-5 [box-shadow:var(--shadow)]", className)}>
      <div className="mb-3 flex items-center gap-3">
        {icon ? <IconBadge icon={icon} tint={tint} /> : null}
        <Heading id={id} className="m-0 text-[1.3rem]">
          {title}
        </Heading>
      </div>
      {children}
    </section>
  );
}
