import { ButtonLink } from "@/components/ui/button";
import { Check } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { HOW } from "@/content/how-it-works";

export type LoopStep = {
  label: string;
  /** Used in "links" mode only: where the step's link goes. */
  href?: string;
  /** Used in "links" mode only: the words of that link, for example "Open Practice". */
  linkLabel?: string;
  /** A word such as "Done" or "Next". Shown as text, never only as colour. */
  status?: string;
  /** Adds a check icon next to the status. */
  done?: boolean;
};

// Adapted from the 21st.dev "Progress Bar Stepper": a thin bar and a title under it for each step.
// Payment and OTP steps, the form panels and the click handlers are gone. The bar is ink and line, never a purple fill.
function StepBody({ step, index, current }: { step: LoopStep; index: number; current: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={cn("block h-1 w-full rounded-full", current ? "bg-ink" : "bg-line-strong")} />
      <span className="mt-2 block font-bold text-ink">
        {index + 1} {step.label}
      </span>
      {step.status ? (
        <span className="flex items-center gap-1 text-sm text-muted-ink">
          {step.done ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
          {step.status}
        </span>
      ) : null}
    </>
  );
}

/**
 * The three steps as an ordered list. "static" is read only (How it works). "links" adds a tertiary link under each
 * step (the dashboard). `current` is the index of the step to mark with aria-current.
 */
export function LoopStepper({
  steps,
  mode,
  current,
}: {
  steps: readonly LoopStep[];
  mode: "static" | "links";
  current?: number;
}) {
  return (
    <ol aria-label={HOW.stepperLabel} className="m-0 grid list-none grid-cols-1 gap-4 p-0 min-[30rem]:grid-cols-3">
      {steps.map((step, i) => {
        const isCurrent = current === i;
        return (
          <li key={step.label} aria-current={isCurrent ? "step" : undefined}>
            <div className="min-h-11">
              <StepBody step={step} index={i} current={isCurrent} />
            </div>
            {mode === "links" && step.href ? (
              <ButtonLink kind="tertiary" href={step.href} className="-ml-2">
                {step.linkLabel ?? step.label}
              </ButtonLink>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
