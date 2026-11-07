import { useId } from "react";
import { cn } from "@/components/ui/cn";
import { ButtonLink } from "@/components/ui/button";
import { HOME } from "@/content/dashboard";
import type { nextStep } from "@/features/home/nextStep";

/**
 * The only primary button on the dashboard: the one thing to do next, with a sentence about what happens.
 * It is the one filled block on the page. The button flips the colours (ink on the fill) so it stands out in every Look.
 */
export function NextStepCard({ step, className }: { step: ReturnType<typeof nextStep>; className?: string }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("relative flex flex-col justify-between gap-6 overflow-hidden rounded-[24px] bg-primary p-6 text-primary-ink sm:p-8", className)}
    >
      <span aria-hidden="true" className="pointer-events-none absolute -top-16 -right-16 size-64 rounded-full bg-primary-ink/10" />
      <span aria-hidden="true" className="pointer-events-none absolute right-24 -bottom-24 size-48 rounded-full bg-primary-ink/10" />
      <div className="relative">
        <h2 id={id} className="m-0 mb-2 text-lg">
          {HOME.nextHeading}
        </h2>
        <p className="m-0 max-w-[24ch] text-[1.65rem] leading-[1.2] font-medium [font-family:var(--font-display)] sm:text-[2rem]">
          {step.sentence}
        </p>
      </div>
      <ButtonLink
        kind="primary"
        arrow
        href={step.href}
        className="relative min-h-[60px] self-start rounded-2xl bg-primary-ink px-8 text-xl text-primary hover:bg-primary-ink hover:brightness-95 focus-visible:outline-primary-ink max-sm:w-full"
      >
        {step.label}
      </ButtonLink>
    </section>
  );
}
