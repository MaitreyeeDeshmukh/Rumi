import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { AlertTriangle } from "@/components/ui/icons";

/** Classes for a text input, textarea or select inside a Field: 16px text, 48px tall. */
export const fieldControlClass =
  "min-h-12 w-full rounded-[14px] border-2 border-line-strong bg-surface px-3 py-2 text-base text-ink aria-[invalid=true]:border-danger";

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

export type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** One control element (gets id, aria-describedby, aria-invalid), or a function that places them. */
  children: ReactElement<Partial<FieldControlProps>> | ((props: FieldControlProps) => ReactNode);
};

export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const props: FieldControlProps = {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  };
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-bold text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="m-0 text-sm text-muted-ink">
          {hint}
        </p>
      )}
      {typeof children === "function" ? children(props) : isValidElement(children) ? cloneElement(children, props) : children}
      {error && (
        <p id={errorId} className="m-0 flex items-start gap-2 text-sm font-bold text-danger">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{`Problem: ${error}`}</span>
        </p>
      )}
    </div>
  );
}
