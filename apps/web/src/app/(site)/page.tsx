import { Actions, CheckList, Section } from "@/components/marketing/Section";
import { DeviceFrame } from "@/components/marketing/DeviceFrame";
import { ExampleCard } from "@/components/marketing/ExampleCard";
import { FaqList } from "@/components/marketing/FaqList";
import { PlanPreview } from "@/components/marketing/PlanPreview";
import { OpenRumiButton } from "@/components/nav/OpenRumiButton";
import { ButtonLink } from "@/components/ui/button";
import { CRISIS } from "@/content/crisis";
import { FAQ, FAQ_COPY, HOME_FAQ_QUESTIONS } from "@/content/faq";
import { HOME } from "@/content/home";
import { HOW } from "@/content/how-it-works";
import { NAV } from "@/content/nav";
import { PAGES, metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/");

export default function HomePage() {
  const page = PAGES["/"];
  const faq = FAQ.filter((f) => HOME_FAQ_QUESTIONS.includes(f.q));
  return (
    <>
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <div>
          <h1 tabIndex={-1} className="text-[clamp(2.1rem,7vw,3.4rem)] font-[750]">
            {page.h1}
          </h1>
          <p className="intro">{page.lead}</p>
          <Actions>
            <OpenRumiButton kind="primary" className="w-full sm:w-auto" />
            <ButtonLink kind="secondary" href="/how-it-works" className="w-full sm:w-auto">
              {HOME.hero.secondary}
            </ButtonLink>
          </Actions>
          <p className="mt-5 text-[.95rem] text-muted-ink">{HOME.hero.fine}</p>
        </div>
        <div className="hidden md:block">
          <DeviceFrame caption={HOME.preview.caption}>
            <PlanPreview />
          </DeviceFrame>
        </div>
      </section>

      <Section id="problem" title={HOME.problem.h2}>
        <p>{HOME.problem.text}</p>
      </Section>

      <Section id="audience" title={HOME.audience.h2}>
        <p>{HOME.audience.text}</p>
      </Section>

      <Section id="steps" title={HOME.steps.h2}>
        <ol className="m-0 grid list-none gap-6 p-0">
          {HOME.steps.items.map((step, i) => (
            <li key={step.title} className="grid gap-4 border-t border-line pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
              <div>
                <h3 className="mt-0">
                  <span className="mr-2 text-muted-ink">{i + 1}</span>
                  {step.title}
                </h3>
                <p className="m-0">{step.text}</p>
              </div>
              <ExampleCard {...HOW.steps[i].example} />
            </li>
          ))}
        </ol>
        <ButtonLink kind="tertiary" href="/how-it-works" className="-ml-2 mt-2">
          {HOME.steps.details}
        </ButtonLink>
      </Section>

      <Section id="different" title={HOME.different.h2}>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {HOME.different.items.map((item) => (
            <div key={item.title} className="border-t border-line-strong pt-3">
              <h3 className="mt-0">{item.title}</h3>
              <p className="m-0">{item.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="control" title={HOME.control.h2}>
        <CheckList items={HOME.control.items} />
        <ButtonLink kind="tertiary" href="/privacy" className="-ml-2 mt-2">
          {HOME.control.link}
        </ButtonLink>
      </Section>

      <section
        aria-label={HOME.safety.label}
        className="relative mt-12 overflow-hidden rounded-card border border-line bg-surface py-4 pr-4 pl-6"
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-danger" />
        <p className="font-bold text-ink">{HOME.safety.text}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <ButtonLink kind="secondary" href="tel:988" className="w-full sm:w-auto">
            {CRISIS.call988}
          </ButtonLink>
          <ButtonLink kind="tertiary" href="/safety">
            {NAV.safetyFull}
          </ButtonLink>
        </div>
      </section>

      <Section id="questions" title={HOME.faq.h2}>
        <FaqList items={faq} />
        <ButtonLink kind="tertiary" href="/help" className="-ml-2 mt-2">
          {FAQ_COPY.allHelp}
        </ButtonLink>
      </Section>

      <Section id="ready" title={HOME.final.h2}>
        <Actions className="mt-0">
          <OpenRumiButton kind="primary" className="w-full sm:w-auto" />
          <ButtonLink kind="secondary" href="/contact" className="w-full sm:w-auto">
            {HOME.final.contact}
          </ButtonLink>
        </Actions>
      </Section>
    </>
  );
}
