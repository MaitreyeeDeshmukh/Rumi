"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";

/** A switch with a visible label (and optional hint) that is part of the click target. */
export function Toggle({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  id,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const switchId = id ?? auto;
  const hintId = hint ? `${switchId}-hint` : undefined;
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <label htmlFor={switchId} className="grid min-w-0 cursor-pointer gap-0.5">
        <span className="font-bold text-ink">{label}</span>
        {hint && (
          <span id={hintId} className="text-sm text-muted-ink">
            {hint}
          </span>
        )}
      </label>
      <Switch id={switchId} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-describedby={hintId} />
    </div>
  );
}
