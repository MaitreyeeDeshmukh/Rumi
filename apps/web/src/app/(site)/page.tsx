import type { CSSProperties } from "react";
import { BookOpen, Eye, MessageSquareText, Repeat } from "@/components/ui/icons";
import { Actions, CheckList } from "@/components/marketing/Section";
import { DeviceFrame } from "@/components/marketing/DeviceFrame";
import { ExampleCard } from "@/components/marketing/ExampleCard";
import { FaqList } from "@/components/marketing/FaqList";
import { PlanPreview } from "@/components/marketing/PlanPreview";
import { OpenRumiButton } from "@/components/nav/OpenRumiButton";
import { ButtonLink } from "@/components/ui/button";
import { FAQ, FAQ_COPY, HOME_FAQ_QUESTIONS } from "@/content/faq";
import { HOME } from "@/content/home";
import { HOW } from "@/content/how-it-works";
import { PAGES, metadataFor } from "@/lib/pages";

export const metadata = metadataFor("/");

const ICONS = [Repeat, BookOpen, Eye, MessageSquareText] as const;
const step = (i: number) => ({ "--i": i }) as CSSProperties;
const H2 = "mt-0 text-[clamp(2rem,4vw,3.5rem)] [overflow-wrap:normal]";
const RULE = "reveal border-t-2 border-line-strong pt-6";

/**
 * Landing page. It uses the whole window (.home-wide lifts the column limit), has no boxed sections and no centred
 * stacks: sections are open, split left and right, and divided by rules. The only Open Rumi is in "Ready to try it?".
 */
export default function HomePage() {
  const page = PAGES["/"];
  const faq = FAQ.filter((f) => HOME_FAQ_QUESTIONS.includes(f.q));
  return (
    <div className="home-wide">
      <section className="hero-glow relative -mx-[var(--gutter)] overflow-hidden px-[var(--gutter)] py-10 md:py-16 xl:py-20">
        <span aria-hidden="true" className="hero-blob hero-blob-a" />
        <span aria-hidden="true" className="hero-blob hero-blob-b" />
        <div className="relative grid gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center xl:gap-20">
          <div>
            <h1 tabIndex={-1} style={step(0)} className="hero-in text-[clamp(2.4rem,6.2vw,6rem)] leading-[1.02] font-[750]">
              {page.h1}
            </h1>
            <p style={step(1)} className="intro hero-in text-[clamp(1.15rem,1.6vw,1.5rem)]">
              {page.lead}
            </p>
            <div style={step(2)} className="hero-in">
              <Actions>
                <ButtonLink kind="secondary" href="/how-it-works" className="w-full sm:w-auto">
                  {HOME.hero.secondary}
                </ButtonLink>
              </Actions>
            </div>
          </div>
          <div className="hidden py-6 md:block lg:justify-self-center">
            <div className="float mx-auto w-[min(100%,17rem)]">
              <DeviceFrame caption={HOME.preview.caption}>
                <PlanPreview />
              </DeviceFrame>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-16 grid gap-10 lg:grid-cols-[1.4fr_1fr] xl:gap-20">
        <section aria-labelledby="problem" className={RULE}>
          <h2 id="problem" className="mt-0 text-[clamp(1.6rem,3vw,2.6rem)]">
            {HOME.problem.h2}
          </h2>
          <p className="m-0 text-lg">{HOME.problem.text}</p>
        </section>
        <section aria-labelledby="audience" className={RULE}>
          <h2 id="audience" className="mt-0 text-[clamp(1.6rem,3vw,2.6rem)]">
            {HOME.audience.h2}
          </h2>
          <p className="m-0">{HOME.audience.text}</p>
        </section>
      </div>

      <section aria-labelledby="steps" className="mt-28">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
          <h2 id="steps" className={`${H2} mb-0`}>
            {HOME.steps.h2}
          </h2>
          <ButtonLink kind="tertiary" href="/how-it-works">
            {HOME.steps.details}
          </ButtonLink>
        </div>
        <ol className="m-0 grid list-none gap-10 p-0 md:grid-cols-3">
          {HOME.steps.items.map((item, i) => (
            <li key={item.title} className={`${RULE} flex flex-col gap-4`}>
              <span aria-hidden="true" className="text-[3.5rem] leading-none font-[750] text-primary">
                {i + 1}
              </span>
              <div>
                <h3 className="mt-0">{item.title}</h3>
                <p className="m-0">{item.text}</p>
              </div>
              <div className="mt-auto">
                <ExampleCard {...HOW.steps[i].example} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="different" className="mt-28">
        <h2 id="different" className={`${H2} mb-10`}>
          {HOME.different.h2}
        </h2>
        <div className="grid gap-x-16 gap-y-10 md:grid-cols-2">
          {HOME.different.items.map((item, i) => {
            const Icon = ICONS[i];
            return (
              <div key={item.title} className={`${RULE} grid grid-cols-[auto_1fr] gap-x-5`}>
                <Icon aria-hidden="true" className="mt-1 size-8 text-primary" />
                <div>
                  <h3 className="mt-0 text-[1.35rem]">{item.title}</h3>
                  <p className="m-0">{item.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="control" className={`${RULE} mt-28 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] xl:gap-16`}>
        <div>
          <h2 id="control" className={H2}>
            {HOME.control.h2}
          </h2>
          <ButtonLink kind="tertiary" href="/privacy" className="-ml-2 mt-2">
            {HOME.control.link}
          </ButtonLink>
        </div>
        <CheckList items={HOME.control.items} />
      </section>

      <section aria-labelledby="questions" className="mt-28 grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:gap-14">
        <div>
          <h2 id="questions" className={H2}>
            {HOME.faq.h2}
          </h2>
          <ButtonLink kind="tertiary" href="/help" className="-ml-2 mt-2">
            {FAQ_COPY.allHelp}
          </ButtonLink>
        </div>
        <FaqList items={faq} searchable />
      </section>

      <section aria-labelledby="ready" className={`${RULE} mt-28 mb-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between`}>
        <h2 id="ready" className="m-0 text-[clamp(2.2rem,5vw,4.5rem)] leading-[1.05]">
          {HOME.final.h2}
        </h2>
        <Actions className="mt-0">
          <OpenRumiButton kind="primary" className="w-full sm:w-auto" />
          <ButtonLink kind="secondary" href="/contact" className="w-full sm:w-auto">
            {HOME.final.contact}
          </ButtonLink>
        </Actions>
      </section>
    </div>
  );
}
