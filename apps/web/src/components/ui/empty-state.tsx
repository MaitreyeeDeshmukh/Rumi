import type { ReactNode } from "react";

/** Shown when a list has nothing yet. Says what is missing and offers one way forward. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-card border border-dashed border-line-strong bg-surface p-5">
      <p className="m-0 text-lg font-bold text-ink">{title}</p>
      {children && <div className="text-muted-ink [&>p:last-child]:mb-0">{children}</div>}
      {action}
    </div>
  );
}
