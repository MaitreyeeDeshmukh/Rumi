"use client";

import { useId, useRef, useState } from "react";
import { useCopy } from "@/components/getReady/useCopy";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Copy, Printer } from "@/components/ui/icons";
import { Toggle } from "@/components/ui/toggle";
import { GET_READY } from "@/content/getReady";
import { MAX_QUESTIONS, addCustomItem, buildSupportCardText } from "@/features/adapters/getReadyKit";
import type { RumiState } from "@/features/shared/types";
import { useRumi } from "@/lib/rumiActive";

/** How I like to be supported: sentence toggles, own sentences, up to two questions, and the printable card. */
export function SupportCardSection({ plan, card }: { plan: NonNullable<RumiState["plan"]>; card: NonNullable<RumiState["supportCard"]> }) {
  const { update } = useRumi();
  const uid = useId();
  const pre = useRef(null as HTMLPreElement | null);
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState("");
  const { message, copy, clear } = useCopy(GET_READY.copied, GET_READY.copyFailed);

  const text = buildSupportCardText(card, plan);
  const questions = plan.items.filter((i) => i.kind === "question" && i.enabled);
  const picked = new Set(card.topQuestionIds);
  const full = picked.size >= MAX_QUESTIONS;

  const change = (fn: (c: NonNullable<RumiState["supportCard"]>) => void) => {
    clear();
    update((d) => {
      if (d.supportCard) fn(d.supportCard);
    });
  };

  const addOwn = () => {
    const r = addCustomItem(card, custom);
    if (r.error) return setCustomError(r.error);
    setCustom("");
    setCustomError("");
    change((c) => {
      c.items = r.card.items;
    });
  };

  return (
    <section aria-labelledby={`${uid}-h`} className="mt-8 grid gap-5">
      <div>
        <h2 id={`${uid}-h`}>{GET_READY.cardHeading}</h2>
        <p className="m-0 text-muted-ink">{GET_READY.cardLead}</p>
      </div>

      <div className="grid gap-1">
        {card.items.map((item) => (
          <Toggle
            key={item.id}
            label={item.text}
            checked={item.enabled}
            onCheckedChange={(v) =>
              change((c) => {
                const it = c.items.find((i) => i.id === item.id);
                if (it) it.enabled = v;
              })
            }
          />
        ))}
      </div>

      <div className="grid gap-2">
        <Field id={`${uid}-own`} label={GET_READY.customLabel} error={customError || undefined}>
          <input
            type="text"
            maxLength={200}
            className={fieldControlClass}
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setCustomError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOwn();
              }
            }}
          />
        </Field>
        <Button kind="secondary" className="justify-self-start" onClick={addOwn}>
          {GET_READY.customButton}
        </Button>
      </div>

      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className="mb-1 p-0 font-bold text-ink">{GET_READY.questionsLegend}</legend>
        {questions.length === 0 ? <p className="m-0 text-muted-ink">{GET_READY.noQuestions}</p> : null}
        {questions.map((q) => {
          const on = picked.has(q.id);
          return (
            <div key={q.id} className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={`${uid}-q-${q.id}`}
                checked={on}
                disabled={!on && full}
                onCheckedChange={(v) =>
                  change((c) => {
                    c.topQuestionIds = v === true ? [...c.topQuestionIds, q.id] : c.topQuestionIds.filter((id) => id !== q.id);
                  })
                }
              />
              <label htmlFor={`${uid}-q-${q.id}`} className="cursor-pointer text-ink">
                {q.text}
              </label>
            </div>
          );
        })}
        {full && questions.length > MAX_QUESTIONS ? <p className="m-0 text-sm text-muted-ink">{GET_READY.questionsLimit}</p> : null}
      </fieldset>

      <div className="grid gap-3">
        <p className="m-0 font-bold text-ink" id={`${uid}-card`}>
          {GET_READY.previewLabel}
        </p>
        <pre
          ref={pre}
          className="printable m-0 whitespace-pre-wrap break-words rounded-card border-2 border-line-strong bg-surface p-4 font-[inherit] text-base text-ink"
        >
          {text || GET_READY.emptyCard}
        </pre>
        <div className="flex flex-wrap gap-3">
          <Button kind="secondary" disabled={!text} onClick={() => copy(text, pre.current)}>
            <Copy aria-hidden="true" className="size-5" />
            {GET_READY.copyCard}
          </Button>
          <Button kind="secondary" disabled={!text} onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-5" />
            {GET_READY.printCard}
          </Button>
        </div>
        <p role="status" className="m-0 min-h-6 text-ink">
          {message}
        </p>
      </div>
    </section>
  );
}
