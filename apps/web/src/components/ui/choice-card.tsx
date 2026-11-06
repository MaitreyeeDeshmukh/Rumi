"use client";

import { useId, type ReactNode } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** The group that holds ChoiceCards (a Radix radio group). */
export { RadioGroup as ChoiceGroup };

/** A card-sized radio option with visible text. The whole card is the click target. */
export function ChoiceCard({
  value,
  title,
  children,
  disabled,
}: {
  value: string;
  title: string;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card border-2 border-line bg-surface p-4 text-ink transition-colors duration-150 hover:bg-lav has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft"
    >
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" />
      <span className="grid min-w-0 gap-0.5">
        <span className="font-bold">{title}</span>
        {children && <span className="text-sm text-muted-ink">{children}</span>}
      </span>
    </label>
  );
}
