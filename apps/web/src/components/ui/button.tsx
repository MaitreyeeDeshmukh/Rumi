import Link from "next/link";
import { cva } from "class-variance-authority";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { ArrowRight } from "@/components/ui/icons";

export type ButtonKind = "primary" | "secondary" | "tertiary" | "danger" | "urgent";

// Purple fill (bg-primary) is only ever on the primary kind. Colours come from theme tokens.
const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[14px] px-5 py-2 text-center text-[1.05rem] leading-tight font-bold no-underline cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-lav disabled:text-muted-ink aria-busy:cursor-progress",
  {
    variants: {
      kind: {
        primary:
          "min-h-[52px] border-2 border-transparent bg-primary text-primary-ink hover:bg-[color-mix(in_srgb,var(--primary),#000_8%)] active:scale-[.98] [[data-reduced-motion=true]_&]:active:scale-100",
        secondary: "min-h-[48px] border-2 border-primary bg-surface text-primary hover:bg-primary-soft",
        tertiary:
          "min-h-[44px] border-2 border-transparent bg-transparent px-2 text-primary underline underline-offset-4 hover:bg-primary-soft",
        danger:
          "min-h-[48px] border-2 border-danger bg-danger text-danger-ink hover:bg-[color-mix(in_srgb,var(--danger),#000_8%)]",
        urgent:
          "min-h-[48px] border-2 border-danger bg-surface text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))]",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { block: false },
  },
);

export function buttonClass(opts: { kind: ButtonKind; block?: boolean }): string {
  return variants({ kind: opts.kind, block: opts.block ?? false });
}

type Common = {
  kind: ButtonKind;
  block?: boolean;
  chrome?: boolean;
  /** A trailing arrow for an action that moves forward (spec 5.1). Decorative: the label says everything. */
  arrow?: boolean;
};

/** Chrome buttons (header, footer) are a little tighter so Urgent help and Menu fit on one row at 320 px. */
const chromeClass = (kind: ButtonKind, chrome?: boolean): string => (chrome && kind !== "tertiary" ? "px-3" : "");

export type ButtonProps = Common &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Sets aria-busy and disabled. */
    loading?: boolean;
    /** Shown while loading. It shares the label's space, so the button keeps its width. */
    loadingLabel?: string;
  };

export function Button({
  kind,
  block,
  chrome,
  arrow,
  loading,
  loadingLabel,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      data-kind={kind}
      data-chrome={chrome ? "true" : undefined}
      aria-busy={loading ? true : undefined}
      disabled={disabled || loading}
      className={cn(buttonClass({ kind, block }), chromeClass(kind, chrome), className)}
    >
      {loading && loadingLabel ? (
        <span className="grid">
          <span aria-hidden="true" className="invisible col-start-1 row-start-1 inline-flex items-center justify-center gap-2">
            {children}
          </span>
          <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-2">{loadingLabel}</span>
        </span>
      ) : (
        <>
          {children}
          {arrow ? <ArrowRight aria-hidden="true" className="size-5 shrink-0" /> : null}
        </>
      )}
    </button>
  );
}

export type ButtonLinkProps = Common &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; children?: ReactNode };

/** A real link that looks like a button. Site paths use next/link; mailto:, tel: and full URLs use a plain anchor. */
export function ButtonLink({ kind, block, chrome, arrow, className, href, children, ...rest }: ButtonLinkProps) {
  const props = {
    ...rest,
    href,
    "data-kind": kind,
    "data-chrome": chrome ? "true" : undefined,
    className: cn(buttonClass({ kind, block }), chromeClass(kind, chrome), className),
  };
  const content = (
    <>
      {children}
      {arrow ? <ArrowRight aria-hidden="true" className="size-5 shrink-0" /> : null}
    </>
  );
  return href.startsWith("/") && !href.startsWith("//") ? <Link {...props}>{content}</Link> : <a {...props}>{content}</a>;
}
