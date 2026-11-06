"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowRight } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { MORE } from "@/content/more";

/** The label every preview screen carries, so sample data is never mistaken for a working feature. */
export function PreviewNote({ children }: { children?: ReactNode }) {
  return (
    <Notice tone="info" title={MORE.previewTitle} className="mb-6">
      <p className="m-0">{children ?? MORE.previewText}</p>
    </Notice>
  );
}

/** A whole-card link with a title, one line of detail and an optional tag. */
export function LinkCard({ href, title, text, tag }: { href: string; title: string; text?: string; tag?: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 rounded-card border-2 border-line bg-surface p-4 text-ink no-underline transition-colors duration-150 hover:border-primary hover:bg-primary-soft"
    >
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-center gap-2 font-bold">
          {title}
          {tag ? <span className="rounded-full border border-line bg-lav px-2 text-sm font-semibold">{tag}</span> : null}
        </span>
        {text ? <span className="text-sm text-muted-ink">{text}</span> : null}
      </span>
      <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-primary" />
    </Link>
  );
}

/** A section with a visible h2. */
export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("mt-8 grid gap-3", className)}>
      <h2 id={id} className="m-0 text-[1.25rem]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A plain card. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-card border border-line bg-surface p-4 text-ink", className)}>{children}</div>;
}

export function NotFound() {
  return <EmptyState title={MORE.notFoundTitle}>{MORE.notFoundText}</EmptyState>;
}

/** Shown for the moment before the browser reads saved data. */
export function Loading() {
  return (
    <p className="text-muted-ink" role="status">
      {MORE.loading}
    </p>
  );
}

/** A delete button that asks once more before it acts. */
export function ConfirmDelete({
  label,
  confirm,
  cancel,
  note,
  onConfirm,
}: {
  label: string;
  confirm: string;
  cancel: string;
  note?: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button kind="tertiary" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  return (
    <div className="grid gap-3 rounded-card border-2 border-danger bg-surface p-4">
      {note ? <p className="m-0 text-ink">{note}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button kind="danger" onClick={onConfirm}>
          {confirm}
        </Button>
        <Button kind="secondary" onClick={() => setAsking(false)}>
          {cancel}
        </Button>
      </div>
    </div>
  );
}

/** A labelled checkbox row with a big click target. */
export function CheckRow({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  detail?: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-h-12 cursor-pointer items-start gap-3 rounded-card border border-line bg-surface p-3 text-ink hover:bg-lav"
    >
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span className="grid gap-0.5">
        <span className={cn("font-semibold", checked && "text-muted-ink line-through")}>{label}</span>
        {detail ? <span className="text-sm text-muted-ink">{detail}</span> : null}
      </span>
    </label>
  );
}

/** Wraps every client-only preview screen, like the main app screens do. */
export function NeedsJs({ children }: { children: ReactNode }) {
  return <div data-needs-js>{children}</div>;
}
