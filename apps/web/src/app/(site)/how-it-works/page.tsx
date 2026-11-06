import { ExampleCard } from "@/components/marketing/ExampleCard";
import { LoopStepper } from "@/components/marketing/LoopStepper";
import { Actions, BulletList, Section } from "@/components/marketing/Section";
import { OpenRumiButton } from "@/components/nav/OpenRumiButton";
import { SitePage } from "@/components/SitePage";
import { ButtonLink } from "@/components/ui/button";
import { HOW } from "@/content/how-it-works";
import { PAGES, metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/how-it-works");

export default function HowItWorksPage() {
  const page = PAGES["/how-it-works"];
  return (
    <SitePage title={page.h1} lead={page.lead}>
      <div className="mt-6">
        <LoopStepper mode="static" steps={HOW.steps.map((s) => ({ label: s.title }))} />
      </div>
      {HOW.steps.map((step, i) => (
        <Section
          key={step.title}
          id={`step-${i + 1}`}
          title={
            <>
              <span className="mr-2 text-muted-ink">{i + 1}</span>
              {step.title}
            </>
          }
        >
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
            <div>
              <p>{step.text}</p>
              <h3 className="mt-4">{HOW.controlLabel}</h3>
              <BulletList items={step.controls} />
              {i === HOW.steps.length - 1 ? <p className="text-muted-ink">{HOW.sampleNote}</p> : null}
            </div>
            <ExampleCard {...step.example} />
          </div>
        </Section>
      ))}
      <Actions className="mt-12">
        <OpenRumiButton kind="primary" className="w-full sm:w-auto" />
        <ButtonLink kind="secondary" href="/safety" className="w-full sm:w-auto">
          {HOW.safety}
        </ButtonLink>
      </Actions>
    </SitePage>
  );
}
