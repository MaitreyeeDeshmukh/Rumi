"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Check } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { StickyActions } from "@/components/ui/sticky-actions";
import { REMEMBER } from "@/content/remember";
import { DEMO_PLAN } from "@/fixtures/demoPlan";
import { groupItems, unconfirmedText } from "@/features/adapters/remember";
import type { PlanStatus, Recap } from "@/features/shared/types";
import { fill } from "@/lib/fill";

const STATUS_ORDER: PlanStatus[] = ["asked_by_me", "asked_by_other", "not_asked", "unclear"];
const planText = (id: string): string => DEMO_PLAN.items.find((i) => i.id === id)?.text ?? "";

/** The recap: points with their source lines, what could not be confirmed, and what the person said. */
export function RecapView({ recap, primary }: { recap: Recap; primary: string }) {
  const [pressed, setPressed] = useState(null as number | null);
  const marked = new Set(pressed === null ? [] : recap.items[pressed]?.evidence);

  const toggle = (index: number) => {
    const next = pressed === index ? null : index;
    setPressed(next);
    const first = next === null ? undefined : recap.items[next].evidence[0];
    if (first) document.getElementById(`line-${first}`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="grid gap-6">
      {groupItems(recap.items).map(({ section, items }) => (
        <section key={section} className="grid gap-2">
          <h2 className="m-0 text-xl">{REMEMBER.sections[section]}</h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {items.map(({ index, item }) => (
              <li key={index}>
                <Button
                  kind="tertiary"
                  block
                  aria-pressed={pressed === index}
                  onClick={() => toggle(index)}
                  className="h-auto justify-start rounded-card border-line bg-surface px-4 py-3 text-left font-normal text-ink no-underline hover:bg-lav aria-pressed:border-primary aria-pressed:bg-primary-soft"
                >
                  <span className="grid min-w-0 gap-1">
                    <span>{item.text}</span>
                    <span className="inline-flex items-center gap-1 text-sm font-bold text-muted-ink">
                      {pressed === index ? <Check aria-hidden="true" className="size-4" /> : null}
                      {pressed === index ? REMEMBER.showing : REMEMBER.showSource}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {recap.unconfirmed.length > 0 && (
        <Notice tone="warn" title={REMEMBER.unconfirmedTitle}>
          <p>{REMEMBER.unconfirmedNote}</p>
          <ul>
            {recap.unconfirmed.map((u) => (
              <li key={u}>{unconfirmedText(u)}</li>
            ))}
          </ul>
        </Notice>
      )}

      <section className="grid gap-3">
        <h2 className="m-0 text-xl">{REMEMBER.myselfHeading}</h2>
        <p className="note m-0">{REMEMBER.myselfNote}</p>
        {STATUS_ORDER.map((status) => {
          const rows = recap.planStatus.filter((p) => p.status === status && planText(p.itemId));
          if (rows.length === 0) return null;
          return (
            <div key={status}>
              <h3 className="m-0 mb-1 text-base">{REMEMBER.status[status]}</h3>
              <ul className="m-0 pl-5">
                {rows.map((p) => (
                  <li key={p.itemId}>{planText(p.itemId)}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="grid gap-2">
        <h2 className="m-0 text-xl">{REMEMBER.transcriptHeading}</h2>
        <ol className="m-0 grid gap-2 pl-6">
          {recap.transcript.map((line) => (
            <li key={line.id} id={`line-${line.id}`} className="whitespace-pre-wrap break-words">
              <strong>{speakerLabel(line.speaker, recap.mySpeaker)}</strong>{" "}
              {marked.has(line.id) ? (
                <mark>
                  {line.text}
                  <span className="sr-only"> {REMEMBER.usedInSummary}</span>
                </mark>
              ) : (
                line.text
              )}
            </li>
          ))}
        </ol>
      </section>

      <p className="note m-0">{REMEMBER.checkClinician}</p>

      <StickyActions>
        <ButtonLink kind="primary" href="/share" arrow block>
          {primary}
        </ButtonLink>
      </StickyActions>
    </div>
  );
}

const speakerLabel = (speaker: string, mine: string): string =>
  fill(speaker === mine ? REMEMBER.voiceMine : REMEMBER.voiceLine, { speaker });
