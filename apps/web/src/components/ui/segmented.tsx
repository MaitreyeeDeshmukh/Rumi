"use client";

import type { ReactNode } from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check } from "@/components/ui/icons";

/** The row with its name written above it (the name is also the radio group's accessible name). */
const withLabel = (label: string, row: ReactNode): ReactNode => (
  <div className="grid gap-2">
    <p aria-hidden="true" className="m-0 text-sm font-bold text-muted-ink">
      {label}
    </p>
    {row}
  </div>
);

/** A short row of exclusive choices. The chosen one has a check and a tinted fill, never a purple fill. */
export function Segmented({
  label,
  value,
  onValueChange,
  options,
  showLabel = false,
}: {
  /** The group's accessible name. With `showLabel` it is also written above the row. */
  label: string;
  showLabel?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  const row = (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      onValueChange={onValueChange}
      orientation="horizontal"
      className="flex flex-wrap gap-2"
    >
      {options.map((o) => (
        <RadioGroupPrimitive.Item
          key={o.value}
          value={o.value}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-2 border-line-strong bg-surface px-4 font-bold text-ink transition-colors duration-150 hover:bg-lav data-[state=checked]:border-primary data-[state=checked]:bg-primary-soft"
        >
          <RadioGroupPrimitive.Indicator asChild>
            <Check aria-hidden="true" className="size-4" />
          </RadioGroupPrimitive.Indicator>
          {o.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
  return showLabel ? withLabel(label, row) : row;
}
