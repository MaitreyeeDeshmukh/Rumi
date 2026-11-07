import type { CSSProperties } from "react";
import Image from "next/image";
import { Actions, CheckList, Section } from "@/components/marketing/Section";
import { DeviceFrame } from "@/components/marketing/DeviceFrame";
import { ExampleCard } from "@/components/marketing/ExampleCard";
import { FaqList } from "@/components/marketing/FaqList";
import { HomeMotion } from "@/components/marketing/HomeMotion";
import { PlanPreview } from "@/components/marketing/PlanPreview";
import { RumiSketch } from "@/components/marketing/RumiSketch";
import { Scribble } from "@/components/marketing/Scribble";
import { OpenRumiButton } from "@/components/nav/OpenRumiButton";
import { ButtonLink } from "@/components/ui/button";
import { CRISIS } from "@/content/crisis";
import { FAQ, FAQ_COPY, HOME_FAQ_QUESTIONS } from "@/content/faq";
import { HOME, HOME_ART } from "@/content/home";
import { HOW } from "@/content/how-it-works";
import { NAV } from "@/content/nav";
import { PAGES, metadataFor } from "@/lib/pages";
import "./home.css";

export const metadata = metadataFor("/");

/** Drawings: Open Doodles and Open Peeps by Pablo Stanley (CC0), recoloured. See public/illustrations/LICENSE.txt. */
const ART = "/illustrations";
const PROBLEM_PEOPLE = [
  { src: "peep-4.svg", w: 321, h: 691 },
  { src: "peep-6.svg", w: 309, h: 652 },
  { src: "peep-7.svg", w: 324, h: 484 },
] as const;
const PEOPLE = [
  { src: "peep-1.svg", w: 462, h: 603 },
  { src: "peep-2.svg", w: 213, h: 715 },
  { src: "peep-3.svg", w: 304, h: 680 },
  { src: "peep-5.svg", w: 246, h: 713 },
  { src: "peep-8.svg", w: 213, h: 694 },
] as const;
const STEP_ART = ["doodle-plan.svg", "doodle-practice.svg", "doodle-recap.svg"] as const;
const NOTE_ART = ["doodle-health.svg", "doodle-calm.svg", "doodle-circles.svg", "doodle-day.svg"] as const;
const NOTE_TILT = ["-1.4deg", "1.1deg", "1deg", "-1.2deg"] as const;

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

/** The headline with its last two words marked by hand. The visible text stays exactly the h1 from PAGES. */
function Headline({ text }: { text: string }) {
  const words = text.split(" ");
  const tail = words.slice(-2).join(" ");
  const head = words.slice(0, -2).join(" ");
  return (
    <h1 tabIndex={-1} className="ld-title">
      <span className="ld-in" style={v({ "--i": 1 })}>
        {head}{" "}
      </span>
      <span className="ld-mark ld-in" style={v({ "--i": 2 })}>
        <span className="ld-hl">{tail}</span>
        <Scribble kind="circle" className="ld-mark-circle" />
      </span>
    </h1>
  );
}

function Kicker({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p aria-hidden="true" className={`ld-hand ld-kicker ${className}`}>
      {text}
    </p>
  );
}

export default function HomePage() {
  const page = PAGES["/"];
  const faq = FAQ.filter((f) => HOME_FAQ_QUESTIONS.includes(f.q));
  return (
    <div className="landing">
      {/* ---------- Hero ---------- */}
      <section className="ld-hero">
        <div className="ld-hero-copy">
          <p aria-hidden="true" className="ld-hand ld-kicker ld-in" style={v({ "--i": 0 })}>
            {HOME_ART.kicker.hero}
            <Scribble kind="arrow-down" className="ld-kicker-arrow" />
          </p>
          <Headline text={page.h1} />
          <p className="intro ld-lead ld-in" style={v({ "--i": 3 })}>
            {page.lead}
          </p>
          <div className="ld-in" style={v({ "--i": 4 })}>
            <Actions>
              <OpenRumiButton kind="primary" className="w-full sm:w-auto" />
              <ButtonLink kind="secondary" href="/how-it-works" className="w-full sm:w-auto">
                {HOME.hero.secondary}
              </ButtonLink>
            </Actions>
            <p className="ld-fine">{HOME.hero.fine}</p>
          </div>
        </div>

        <div className="ld-collage">
          <figure className="ld-photo">
            <span className="ld-tape" aria-hidden="true" />
            <Image
              src={`${ART}/doodle-waiting-room.svg`}
              alt={HOME_ART.heroAlt}
              width={1024}
              height={768}
              priority
              unoptimized
            />
          </figure>
          <div className="ld-phone hidden md:block">
            <DeviceFrame caption={HOME.preview.caption}>
              <PlanPreview />
            </DeviceFrame>
          </div>
          <RumiSketch size={104} className="ld-hero-rumi" />
          <Scribble kind="sparkle" className="ld-spark ld-spark-a" />
          <Scribble kind="sparkle" className="ld-spark ld-spark-b" />
        </div>
      </section>
      <Scribble kind="wave" className="ld-divider" />

      {/* ---------- Problem ---------- */}
      <div className="ld-block reveal">
        <Kicker text={HOME_ART.kicker.problem} />
        <Section id="problem" title={HOME.problem.h2} className="ld-section">
          <div className="ld-split">
            <p className="ld-body">{HOME.problem.text}</p>
            <ul className="ld-blobs" aria-hidden="true">
              {PROBLEM_PEOPLE.map((p) => (
                <li key={p.src}>
                  <Image src={`${ART}/${p.src}`} alt="" width={p.w} height={p.h} unoptimized />
                </li>
              ))}
            </ul>
          </div>
        </Section>
      </div>

      {/* ---------- Audience ---------- */}
      <div className="ld-block reveal">
        <Kicker text={HOME_ART.kicker.audience} />
        <Section id="audience" title={HOME.audience.h2} className="ld-section">
          <p className="ld-body">{HOME.audience.text}</p>
          <ul className="ld-people" aria-hidden="true">
            {PEOPLE.map((p, n) => (
              <li key={p.src} style={v({ "--i": n })}>
                <Image src={`${ART}/${p.src}`} alt="" width={p.w} height={p.h} unoptimized />
              </li>
            ))}
          </ul>
          <Scribble kind="ground" className="ld-ground" />
        </Section>
      </div>

      {/* ---------- Steps ---------- */}
      <div className="ld-band">
        <div className="ld-block reveal">
          <Kicker text={HOME_ART.kicker.steps} />
          <Section id="steps" title={<span className="ld-hl-static">{HOME.steps.h2}</span>} className="ld-section">
            <ol className="ld-steps">
              <Scribble kind="path" className="ld-steps-path" />
              {HOME.steps.items.map((step, i) => (
                <li key={step.title} className="ld-step" style={v({ "--i": i })}>
                  <div className="ld-step-art" aria-hidden="true">
                    <Image src={`${ART}/${STEP_ART[i]}`} alt="" width={1024} height={768} unoptimized />
                  </div>
                  <h3>
                    <span className="ld-hand ld-step-n" aria-hidden="true">
                      {i + 1}
                    </span>
                    {step.title}
                  </h3>
                  <p>{step.text}</p>
                  <ExampleCard {...HOW.steps[i].example} />
                </li>
              ))}
            </ol>
            <ButtonLink kind="tertiary" href="/how-it-works" className="-ml-2 mt-6">
              {HOME.steps.details}
            </ButtonLink>
          </Section>
        </div>
      </div>

      {/* ---------- Different ---------- */}
      <div className="ld-block reveal">
        <Kicker text={HOME_ART.kicker.different} />
        <Section id="different" title={HOME.different.h2} className="ld-section">
          <ul className="ld-notes">
            {HOME.different.items.map((item, n) => (
              <li key={item.title} className="ld-note" style={v({ "--r": NOTE_TILT[n], "--i": n })}>
                <span className="ld-tape" aria-hidden="true" />
                <Image src={`${ART}/${NOTE_ART[n]}`} alt="" width={1024} height={768} unoptimized />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* ---------- Control ---------- */}
      <div className="ld-block reveal">
        <Kicker text={HOME_ART.kicker.control} />
        <Section id="control" title={HOME.control.h2} className="ld-section">
          <div className="ld-ruled">
            <CheckList items={HOME.control.items} />
          </div>
          <ButtonLink kind="tertiary" href="/privacy" className="-ml-2 mt-4">
            {HOME.control.link}
          </ButtonLink>
        </Section>
      </div>

      {/* ---------- Safety ---------- */}
      <section aria-label={HOME.safety.label} className="ld-safety reveal">
        <span aria-hidden="true" className="ld-safety-bar" />
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

      {/* ---------- FAQ ---------- */}
      <div className="ld-block reveal">
        <Kicker text={HOME_ART.kicker.faq} />
        <Section id="questions" title={HOME.faq.h2} className="ld-section">
          <FaqList items={faq} />
          <ButtonLink kind="tertiary" href="/help" className="-ml-2 mt-2">
            {FAQ_COPY.allHelp}
          </ButtonLink>
        </Section>
      </div>

      {/* ---------- Final ---------- */}
      <div className="ld-final reveal">
        <div className="ld-final-art" aria-hidden="true">
          <Image src={`${ART}/doodle-float.svg`} alt="" width={1024} height={768} unoptimized />
          <RumiSketch size={80} className="ld-final-rumi" />
        </div>
        <Kicker text={HOME_ART.kicker.final} />
        <Section id="ready" title={HOME.final.h2} className="ld-section">
          <Actions className="mt-0 sm:justify-center">
            <OpenRumiButton kind="primary" className="w-full sm:w-auto" />
            <ButtonLink kind="secondary" href="/contact" className="w-full sm:w-auto">
              {HOME.final.contact}
            </ButtonLink>
          </Actions>
        </Section>
        <p className="ld-credit">{HOME_ART.credit}</p>
      </div>

      <HomeMotion />
    </div>
  );
}
