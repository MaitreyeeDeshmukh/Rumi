"use client";

import { Segmented } from "@/components/ui/segmented";

export type Ready = 1 | 2 | 3 | 4 | 5;
const CHOICES = [1, 2, 3, 4, 5] as const;

/** Five buttons, 1 to 5. Optional: no button is chosen until the person picks one. */
export function Readiness({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: Ready | undefined;
  onChange: (value: Ready) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="m-0 font-bold text-ink">{label}</p>
      {hint ? <p className="note m-0">{hint}</p> : null}
      <Segmented
        label={label}
        value={value ? String(value) : ""}
        onValueChange={(v) => onChange(Number(v) as Ready)}
        options={CHOICES.map((n) => ({ value: String(n), label: String(n) }))}
      />
    </div>
  );
}
