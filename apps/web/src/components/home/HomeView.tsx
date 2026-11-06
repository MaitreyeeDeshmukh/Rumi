import { Block } from "@/components/home/Block";
import { NextStepCard } from "@/components/home/NextStepCard";
import { LoopStepper } from "@/components/marketing/LoopStepper";
import { ButtonLink } from "@/components/ui/button";
import { MessageSquareText, Settings, Share2 } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { HOME, NEXT_STEPS, STATUS } from "@/content/dashboard";
import { PAGES_COPY } from "@/content/pages";
import { HELP_KINDS, helpLevelWord } from "@/features/home/helpLevel";
import { nextStep, stepStatus } from "@/features/home/nextStep";
import type { HomeViewProps } from "@/features/home/useDashboardInput";
import { fill, plural } from "@/lib/fill";

const STEP_ROUTES = ["/get-ready", "/practice", "/remember"] as const;

/** The dashboard (spec 7.1). Pure: everything it shows comes in through props. */
export function HomeView({ state, helpLevels, lastPractice, memoryOn, storageOk }: HomeViewProps) {
  const next = nextStep(state);
  const status = stepStatus(state);
  const statuses = [status.getReady, status.practice, status.remember];
  const firstOpen = statuses.findIndex((s) => s !== STATUS.done);
  const plan = state.plan && state.plan.items.length > 0 ? state.plan : null;
  const linesOn = plan ? plan.items.filter((i) => i.enabled).length : 0;
  const kitReady = plan !== null && state.supportCard !== null; // the card is null until it has lines

  return (
    <>
      {storageOk ? null : (
        <Notice tone="warn" className="mb-5">
          <p>{HOME.storageOff}</p>
        </Notice>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-5">
        <div className="grid gap-5 lg:col-span-3">
          <NextStepCard step={next} />

          <Block title={HOME.stepsHeading}>
            <LoopStepper
              mode="links"
              current={firstOpen === -1 ? undefined : firstOpen}
              steps={STEP_ROUTES.map((route, i) => {
                const title = PAGES_COPY[route].title;
                return {
                  label: title,
                  href: route,
                  linkLabel: fill(HOME.openStep, { step: title }),
                  status: statuses[i],
                  done: statuses[i] === STATUS.done,
                };
              })}
            />
          </Block>

          <Block title={HOME.planHeading}>
            {plan ? (
              <>
                <p>{plan.mainConcern}</p>
                <p>
                  {plural(linesOn, HOME.linesOn)}, {plural(plan.items.length - linesOn, HOME.linesOff)}
                </p>
                <ButtonLink kind="secondary" href="/get-ready">
                  {HOME.editPlan}
                </ButtonLink>
              </>
            ) : (
              <>
                <p>{HOME.noPlan}</p>
                <ButtonLink kind="secondary" href={NEXT_STEPS.make_plan.href}>
                  {NEXT_STEPS.make_plan.label}
                </ButtonLink>
              </>
            )}
          </Block>
        </div>

        <div className="grid gap-5 lg:col-span-2">
          <Block title={HOME.practiceHeading}>
            {lastPractice ? (
              <>
                <p>{fill(HOME.practiced, { focus: lastPractice.focusLabel })}</p>
                <p>{fill(HOME.saidMyself, { x: lastPractice.saidMyself, y: lastPractice.total })}</p>
                {lastPractice.saidWithHelp > 0 ? <p>{fill(HOME.saidWithHelp, { z: lastPractice.saidWithHelp })}</p> : null}
                {lastPractice.trend ? <p>{lastPractice.trend}</p> : null}
                <ButtonLink kind="secondary" href="/practice">
                  {HOME.practiceAgain}
                </ButtonLink>
              </>
            ) : (
              <p className="m-0">{HOME.noPractice}</p>
            )}
          </Block>

          {helpLevels ? (
            <Block title={HOME.helpHeading}>
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

          <Block title={HOME.kitHeading}>
            {kitReady ? (
              <>
                <p>{HOME.kitReady}</p>
                <ButtonLink kind="secondary" href="/kit">
                  {HOME.openKit}
                </ButtonLink>
              </>
            ) : (
              <>
                <p>{HOME.kitNeeds}</p>
                <ButtonLink kind="secondary" href="/get-ready">
                  {HOME.goGetReady}
                </ButtonLink>
              </>
            )}
          </Block>

          <Block title={HOME.quickHeading}>
            <div className="grid justify-items-start gap-1">
              <ButtonLink kind="tertiary" href="/say-it">
                <MessageSquareText aria-hidden="true" className="size-5" />
                {HOME.sayIt}
              </ButtonLink>
              <ButtonLink kind="tertiary" href="/share">
                <Share2 aria-hidden="true" className="size-5" />
                {HOME.share}
              </ButtonLink>
              <ButtonLink kind="tertiary" href="/settings">
                <Settings aria-hidden="true" className="size-5" />
                {HOME.settings}
              </ButtonLink>
            </div>
          </Block>

          <Block title={HOME.privacyHeading}>
            <p>{HOME.saved}</p>
            <p>{fill(HOME.memory, { state: memoryOn ? HOME.memoryOn : HOME.memoryOff })}</p>
            <ButtonLink kind="tertiary" href="/settings" className="-ml-2">
              {HOME.manage}
            </ButtonLink>
          </Block>
        </div>
      </div>
    </>
  );
}
