"use client";

import { Readiness, type Ready } from "@/components/practice/Readiness";
import { Button, ButtonLink } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { StickyActions } from "@/components/ui/sticky-actions";
import { HOME } from "@/content/dashboard";
import { PRACTICE } from "@/content/practice";
import { helpTrend } from "@/features/home/helpLevel";
import { itemsForFocus } from "@/features/practice/labels";
import { summarizeSession } from "@/features/practice/summarizeSession";
import type { HelpLevel, PracticeSession, VisitPlan } from "@/features/shared/types";
import { fill, plural } from "@/lib/fill";

/** The most help the person used in one practice. */
const mostHelp = (s: PracticeSession): HelpLevel => Math.max(0, ...Object.values(s.helpLevelUsed)) as HelpLevel;

/** The practice summary: counts in words, the plan lines with a tick each, and the way on. No score. */
export function Summary({
  session,
  before,
  plan,
  onToggle,
  onReadyAfter,
  onAgain,
}: {
  session: PracticeSession;
  /** The practice before this one, if any. */
  before: PracticeSession | undefined;
  plan: VisitPlan;
  onToggle: (itemId: string, covered: boolean) => void;
  onReadyAfter: (value: Ready) => void;
  onAgain: () => void;
}) {
  const s = summarizeSession(session, plan);
  const trend = before ? helpTrend(mostHelp(before), mostHelp(session)) : null;
  const items = itemsForFocus(plan, session.focus);
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="m-0 text-lg font-bold">{fill(HOME.practiced, { focus: s.focusLabel })}</p>
        <p className="m-0">{fill(HOME.saidMyself, { x: s.saidMyself, y: s.total })}</p>
        {s.saidWithHelp > 0 ? <p className="m-0">{fill(HOME.saidWithHelp, { z: s.saidWithHelp })}</p> : null}
        {s.helpCount > 0 ? <p className="m-0">{plural(s.helpCount, PRACTICE.helpCount)}</p> : null}
        {trend ? <p className="m-0">{trend}</p> : null}
        {session.readyBefore && session.readyAfter ? (
          <p className="m-0">{fill(PRACTICE.readyBeforeAfter, { before: session.readyBefore, after: session.readyAfter })}</p>
        ) : null}
      </div>

      <section aria-labelledby="practice-lines" className="grid gap-1">
        <h2 id="practice-lines" className="mt-0">
          {PRACTICE.linesHeading}
        </h2>
        <p className="note m-0">{PRACTICE.linesHint}</p>
        {items.map((item) => {
          const on = session.coveredItemIds.includes(item.id);
          return (
            <Toggle
              key={item.id}
              label={item.text}
              hint={on ? PRACTICE.saidIt : PRACTICE.notYet}
              checked={on}
              onCheckedChange={(next) => onToggle(item.id, next)}
            />
          );
        })}
      </section>

      <Readiness label={PRACTICE.readyAfterLabel} value={session.readyAfter} onChange={onReadyAfter} />

      <StickyActions>
        <div className="grid gap-3 sm:flex">
          <Button kind="primary" arrow block onClick={onAgain} className="sm:w-auto">
            {PRACTICE.practiceAgain}
          </Button>
          <ButtonLink kind="secondary" href="/home">
            {PRACTICE.goHome}
          </ButtonLink>
        </div>
      </StickyActions>
    </div>
  );
}
