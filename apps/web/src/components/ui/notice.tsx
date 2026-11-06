import type { ReactNode } from "react";
import { AlertTriangle, Check, Info } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";

export type NoticeTone = "info" | "warn" | "success";

const TONE = {
  info: { box: "bg-blue", Icon: Info },
  warn: { box: "bg-apricot", Icon: AlertTriangle },
  success: { box: "bg-sage", Icon: Check },
} as const;

/** A short message with an icon and words, so colour is never the only cue. */
export function Notice({
  tone,
  title,
  children,
  className,
}: {
  tone: NoticeTone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const { box, Icon } = TONE[tone];
  return (
    <div
      role="note"
      data-tone={tone}
      className={cn("flex items-start gap-3 rounded-card border border-line-strong p-4 text-ink", box, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-6 shrink-0" />
      <div className="min-w-0">
        {title && <p className="m-0 font-bold">{title}</p>}
        <div className="[&>p:last-child]:mb-0">{children}</div>
      </div>
    </div>
  );
}
