import { Block } from "@/components/home/Block";
import { ButtonLink } from "@/components/ui/button";
import { HOME } from "@/content/dashboard";
import type { nextStep } from "@/features/home/nextStep";

/** The only primary button on the dashboard: the one thing to do next, with a sentence about what happens. */
export function NextStepCard({ step }: { step: ReturnType<typeof nextStep> }) {
  return (
    <Block title={HOME.nextHeading}>
      <p>{step.sentence}</p>
      <ButtonLink kind="primary" arrow href={step.href}>
        {step.label}
      </ButtonLink>
    </Block>
  );
}
