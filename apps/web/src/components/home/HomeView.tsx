import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";
import { Block, IconBadge, type Tint } from "@/components/home/Block";
import { MemoryCard } from "@/components/home/MemoryCard";
import { NextStepCard } from "@/components/home/NextStepCard";
import { TONAL } from "@/components/home/styles";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { BookOpen, CalendarDays, Check, ClipboardList, MessageCircle, Share2 } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { APPT } from "@/content/appointments";
import { HOME, STATUS } from "@/content/dashboard";
import { HOW } from "@/content/how-it-works";
import { PAGES_COPY } from "@/content/pages";
import { dayLong, timeText } from "@/features/appointments/appointments";
import { HELP_KINDS, helpLevelWord } from "@/features/home/helpLevel";
import { nextStep, stepStatus } from "@/features/home/nextStep";
import type { HomeViewProps } from "@/features/home/useDashboardInput";
import { fill, plural } from "@/lib/fill";

const STEPS: readonly { route: "/get-ready" | "/practice" | "/remember"; icon: LucideIcon; tint: Tint }[] = [
  { route: "/get-ready", icon: ClipboardList, tint: "sage" },
  { route: "/practice", icon: MessageCircle, tint: "blue" },
  { route: "/remember", icon: BookOpen, tint: "apricot" },
];

/** One of the three steps: its icon, number, status and one button. The step to do now has a heavier border. */
function StepCard({ index, status, current }: { index: number; status: string; current: boolean }) {
  const { route, icon, tint } = STEPS[index];
  const title = PAGES_COPY[route].title;
  const done = status === STATUS.done;
  return (
    <div className={cn("flex flex-col gap-3 rounded-card bg-surface p-5 [box-shadow:var(--shadow)]", current ? "border-2 border-primary" : "border border-line")}>
      <div className="flex items-center gap-3">
        <IconBadge icon={icon} tint={tint} />
        <h3 className="m-0 text-[1.3rem]">
          <span className="text-muted-ink">{index + 1}</span> {title}
        </h3>
      </div>
      <span className="inline-flex items-center gap-2 self-start rounded-full border border-line-strong px-3 py-0.5 text-[.9375rem] font-semibold text-muted-ink">
        {done ? (
          <Check aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full border-2 border-muted-ink" />
        )}
        {status}
      </span>
      <ButtonLink kind="secondary" arrow block className={TONAL} href={route}>
        {fill(HOME.openStep, { step: title })}
      </ButtonLink>
    </div>
  );
}

/** The dashboard (spec 7.1). Pure: everything it shows comes in through props. */
export function HomeView({ state, helpLevels, lastPractice, storageOk, nextAppointment }: HomeViewProps) {
  const next = nextStep(state);
  const status = stepStatus(state);
  const statuses = [status.getReady, status.practice, status.remember];
  const firstOpen = statuses.findIndex((s) => s !== STATUS.done);
  const plan = state.plan && state.plan.items.length > 0 ? state.plan : null;
  const linesOn = plan ? plan.items.filter((i) => i.enabled).length : 0;
  const kitReady = plan !== null && state.supportCard !== null; // the card is null until it has lines

  // What sits under each step, in the same column: the plan under Get ready, the last practice under Practice, the kit under Remember.
  const details = [
    <Block key="get-ready" title={HOME.planHeading} level={3}>
      {plan ? (
        <>
          <p>{plan.mainConcern}</p>
          <p className="m-0">
            {plural(linesOn, HOME.linesOn)}, {plural(plan.items.length - linesOn, HOME.linesOff)}
          </p>
        </>
      ) : (
        <p className="m-0">{HOME.noPlan}</p>
      )}
    </Block>,
    <Fragment key="practice">
      <Block title={HOME.practiceHeading} level={3}>
        {lastPractice ? (
          <>
            <p>{fill(HOME.practiced, { focus: lastPractice.focusLabel })}</p>
            <p>{fill(HOME.saidMyself, { x: lastPractice.saidMyself, y: lastPractice.total })}</p>
            {lastPractice.saidWithHelp > 0 ? <p>{fill(HOME.saidWithHelp, { z: lastPractice.saidWithHelp })}</p> : null}
            {lastPractice.trend ? <p className="m-0">{lastPractice.trend}</p> : null}
          </>
        ) : (
          <p className="m-0">{HOME.noPractice}</p>
        )}
      </Block>
      {helpLevels ? (
        <Block title={HOME.helpHeading} level={3}>
          <ul className="m-0 mb-3 grid list-none gap-2 p-0">
            {HELP_KINDS.map(({ kind, label }) => (
              <li key={kind} className="flex flex-wrap justify-between gap-x-3">
                <span>{label}</span>
                <span className="font-bold">{helpLevelWord(helpLevels[kind] ?? 1)}</span>
              </li>
            ))}
          </ul>
          <p className="note m-0">{HOME.helpCaption}</p>
        </Block>
      ) : null}
    </Fragment>,
    <Block key="remember" title={HOME.kitHeading} level={3}>
      {kitReady ? (
        <>
          <p>{HOME.kitReady}</p>
          <ButtonLink kind="secondary" block className={TONAL} href="/kit">
            {HOME.openKit}
          </ButtonLink>
        </>
      ) : (
        <p className="m-0">{HOME.kitNeeds}</p>
      )}
    </Block>,
  ];

  return (
    <div className="grid gap-6">
      {storageOk ? null : (
        <Notice tone="warn">
          <p>{HOME.storageOff}</p>
        </Notice>
      )}

      <div className="grid items-stretch gap-6 lg:grid-cols-3">
        <NextStepCard step={next} className="lg:col-span-2" />
        <Block title={APPT.homeHeading} icon={CalendarDays} tint="blue">
          {nextAppointment ? (
            <p>
              {fill(APPT.homeNext, {
                what: `${APPT.care[nextAppointment.care]} with ${nextAppointment.providerName}`,
                day: dayLong(nextAppointment.date),
                time: timeText(nextAppointment.time),
              })}
            </p>
          ) : (
            <p>{APPT.homeNone}</p>
          )}
          <ButtonLink
            kind="secondary"
            block
            className={cn(TONAL, "mt-auto")}
            href={nextAppointment ? `/appointment?id=${nextAppointment.id}` : "/appointments/new"}
          >
            {nextAppointment ? APPT.homeOpen : APPT.book}
          </ButtonLink>
        </Block>
      </div>

      <section aria-labelledby="home-steps" className="grid gap-3">
        <h2 id="home-steps" className="m-0 text-2xl">
          {HOME.stepsHeading}
        </h2>
        <ol aria-label={HOW.stepperLabel} className="m-0 grid list-none items-start gap-6 p-0 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.route} aria-current={firstOpen === i ? "step" : undefined} className="grid gap-4">
              <StepCard index={i} status={statuses[i]} current={firstOpen === i} />
              {details[i]}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid items-stretch gap-6 lg:grid-cols-3">
        <MemoryCard className="lg:col-span-2" />
        <Block title={HOME.quickHeading}>
          <nav aria-label={HOME.quickHeading} className="grid gap-3">
            <ButtonLink kind="secondary" block className={TONAL} href="/share">
              <Share2 aria-hidden="true" className="size-5" />
              {HOME.share}
            </ButtonLink>
          </nav>
        </Block>
      </div>
    </div>
  );
}
