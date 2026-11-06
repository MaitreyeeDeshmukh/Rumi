"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { HELP_LEVEL_WORDS } from "@/content/dashboard";
import { PRACTICE } from "@/content/practice";
import { composeBlank, helpAnswer, type HelpLevelShown } from "@/features/shims/practice";
import type { PlanItem } from "@/features/shims/types";

export type HelpState = { item: PlanItem | null; level: HelpLevelShown };

function Body({
  item,
  level,
  onUse,
  onMore,
}: {
  item: PlanItem;
  level: HelpLevelShown;
  onUse: (text: string) => void;
  onMore: () => void;
}) {
  const [typed, setTyped] = useState("");
  const answer = helpAnswer(item, level);
  const needsBlank = level === 2 && typed.trim() === "";
  return (
    <>
      <p className="m-0 font-bold">
        {PRACTICE.helpFor} {HELP_LEVEL_WORDS[level].toLowerCase()}
      </p>
      {level === 2 ? (
        <Field id="help-blank" label={PRACTICE.helpBlankLabel}>
          {(field) => (
            <div className="grid gap-2">
              <p className="m-0" data-testid="help-prefix">
                {answer.prefix}
              </p>
              <input
                {...field}
                type="text"
                className={fieldControlClass}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          )}
        </Field>
      ) : (
        <p className="m-0 text-lg" data-testid="help-text">
          {answer.text}
        </p>
      )}
      {level > 1 ? (
        <Button
          kind="primary"
          arrow
          block
          disabled={needsBlank}
          onClick={() => onUse(level === 2 ? composeBlank(answer, typed) : answer.text)}
        >
          {PRACTICE.helpUse}
        </Button>
      ) : null}
      {needsBlank ? <p className="note m-0">{PRACTICE.helpFillFirst}</p> : null}
      {level < 3 ? (
        <Button kind="secondary" block onClick={onMore}>
          {PRACTICE.helpMore}
        </Button>
      ) : null}
    </>
  );
}

/** Help me say it: a hint, then a sentence with a blank, then the whole sentence. Close comes from Sheet. */
export function HelpSheet({
  help,
  onOpenChange,
  onMore,
  onUse,
}: {
  help: HelpState | null;
  onOpenChange: (open: boolean) => void;
  onMore: () => void;
  onUse: (text: string) => void;
}) {
  return (
    <Sheet open={help !== null} onOpenChange={onOpenChange} title={PRACTICE.helpTitle}>
      {help?.item ? (
        // A new level starts with an empty blank.
        <Body key={help.level} item={help.item} level={help.level} onUse={onUse} onMore={onMore} />
      ) : (
        <p className="m-0">{PRACTICE.helpNothing}</p>
      )}
    </Sheet>
  );
}
