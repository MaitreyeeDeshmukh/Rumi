"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { StickyActions } from "@/components/ui/sticky-actions";
import { HOME } from "@/content/dashboard";
import { PRACTICE } from "@/content/practice";
import { helpTrend } from "@/features/home/helpLevel";
import { useMemoryControls } from "@/features/memory/useMemoryControls";
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
  onAgain,
}: {
  session: PracticeSession;
  /** The practice before this one, if any. */
  before: PracticeSession | undefined;
  plan: VisitPlan;
  onToggle: (itemId: string, covered: boolean) => void;
  onAgain: () => void;
}) {
  // The practice just ended: with memory on, this hook syncs once on mount, so the help level this practice needed (per kind
  // of question) is saved and mirrored for recall. Facts are ids and levels only, nothing the person typed.
  useMemoryControls();
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
