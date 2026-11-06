"use client";

import { useId, useState, type FormEvent } from "react";
import { Card, CheckRow, ConfirmDelete, LinkCard, Loading, NeedsJs, NotFound, PreviewNote, Section } from "@/components/more/parts";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { DAY, DEFAULT_STEPS, ENCOURAGEMENT, MONEY, MONEY_KINDS, STEP_LIBRARY } from "@/content/day";
import { moreStore, newId, todayIso, useMore, type Task } from "@/features/more/store";
import { fill } from "@/lib/fill";

/** Steps for a task: the first library entry whose keyword is in the task, else the general steps. */
export function stepsFor(task: string): string[] {
  const t = task.toLowerCase();
  const hit = STEP_LIBRARY.find((e) => e.keys.some((k) => t.includes(k)));
  return [...(hit ? hit.steps : DEFAULT_STEPS)];
}

const setTask = (id: string, fn: (t: Task) => Task) => moreStore.update((st) => ({ ...st, tasks: st.tasks.map((t) => (t.id === id ? fn(t) : t)) }));

function TaskRow({ t }: { t: Task }) {
  return (
    <div className="grid gap-2 rounded-card border border-line bg-surface p-3">
      <CheckRow checked={t.done} onChange={(v) => setTask(t.id, (x) => ({ ...x, done: v }))} label={t.text} />
      <div className="flex flex-wrap gap-2">
        {!t.done ? (
          <ButtonLink kind="secondary" href={`/home/my-day/task/${t.id}`} className="min-h-11">
            {DAY.startWithMe}
          </ButtonLink>
        ) : null}
        <Button kind="tertiary" onClick={() => moreStore.update((st) => ({ ...st, tasks: st.tasks.filter((x) => x.id !== t.id) }))}>
          {DAY.remove}
        </Button>
      </div>
    </div>
  );
}

/** /home/my-day: today's short list, older open tasks, and a link to Money Mirror. */
export function MyDay() {
  const s = useMore();
  const inputId = useId();
  const [text, setText] = useState("");
  const today = todayIso();
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    moreStore.update((st) => ({ ...st, tasks: [...st.tasks, { id: newId(), text: t.slice(0, 200), date: today, done: false, steps: [] }] }));
    setText("");
  };
  const line = ENCOURAGEMENT[new Date().getDate() % ENCOURAGEMENT.length] ?? "";
  const todays = s ? s.tasks.filter((t) => t.date === today && !t.done) : [];
  const older = s ? s.tasks.filter((t) => t.date < today && !t.done) : [];
  const done = s ? s.tasks.filter((t) => t.date === today && t.done) : [];
  return (
    <Screen title={DAY.title} lead={DAY.lead}>
      <PreviewNote />
      <NeedsJs>
        <Notice tone="success" className="mb-6">
          <p className="m-0">{line}</p>
        </Notice>
        <form onSubmit={add} className="grid gap-3">
          <Field id={inputId} label={DAY.addLabel} hint={DAY.addHint}>
            <input className={fieldControlClass} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button kind="primary" type="submit" disabled={!text.trim()}>
            {DAY.add}
          </Button>
        </form>
        {!s ? (
          <Loading />
        ) : (
          <>
            <Section title={DAY.todayTitle}>
              {todays.length === 0 ? <EmptyState title={DAY.emptyTitle}>{DAY.emptyText}</EmptyState> : todays.map((t) => <TaskRow key={t.id} t={t} />)}
            </Section>
            {older.length > 0 ? (
              <Section title={DAY.olderTitle}>
                {older.map((t) => (
                  <TaskRow key={t.id} t={t} />
                ))}
              </Section>
            ) : null}
            {done.length > 0 ? (
              <Section title={DAY.doneTitle}>
                {done.map((t) => (
                  <TaskRow key={t.id} t={t} />
                ))}
              </Section>
            ) : null}
          </>
        )}
        <Section title={DAY.moneyLink}>
          <LinkCard href="/home/money" title={DAY.moneyLink} text={DAY.moneyText} />
        </Section>
      </NeedsJs>
    </Screen>
  );
}

/** /home/my-day/task/:id: Start with me, the task cut into small steps. */
export function StartWithMe({ id }: { id: string }) {
  const s = useMore();
  const task = s?.tasks.find((t) => t.id === id);
  if (!s || !task)
    return (
      <Screen title={DAY.stepsTitle} lead={DAY.stepsLead}>
        {!s ? <Loading /> : <NotFound />}
      </Screen>
    );
  const steps = task.steps.length > 0 ? task.steps : stepsFor(task.text).map((text) => ({ text, done: false }));
  const doneCount = steps.filter((x) => x.done).length;
  const toggle = (i: number, v: boolean) => setTask(task.id, (t) => ({ ...t, steps: steps.map((x, j) => (j === i ? { ...x, done: v } : x)) }));
  return (
    <Screen title={task.text} lead={DAY.stepsLead}>
      <PreviewNote />
      <NeedsJs>
        <p className="m-0 mb-3 text-muted-ink" role="status">
          {fill(DAY.stepsOf, { done: doneCount, total: steps.length })}
        </p>
        <ol className="m-0 grid gap-3 p-0">
          {steps.map((x, i) => (
            <li key={x.text} className="list-none">
              <CheckRow checked={x.done} onChange={(v) => toggle(i, v)} label={x.text} />
            </li>
          ))}
        </ol>
        <div className="mt-6">
          {task.done ? (
            <Notice tone="success">
              <p className="m-0">{DAY.finished}</p>
            </Notice>
          ) : (
            <Button kind="primary" block onClick={() => setTask(task.id, (t) => ({ ...t, done: true, steps }))}>
              {DAY.finish}
            </Button>
          )}
        </div>
      </NeedsJs>
    </Screen>
  );
}

const usd = (cents: number): string => (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

/** Dollars typed by a person ("4.50", "$4", "1,200") as cents, or null. */
export function toCents(input: string): number | null {
  const n = Number(input.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && input.trim() !== "" ? Math.round(n * 100) : null;
}

/** /home/money: a weekly budget, what you bought, and totals by kind. No advice. */
export function MoneyMirror() {
  const s = useMore();
  const ids = { budget: useId(), what: useId(), amount: useId() };
  const [budget, setBudget] = useState("");
  const [budgetErr, setBudgetErr] = useState("");
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState(MONEY_KINDS[0] ?? "Other");
  const [addErr, setAddErr] = useState("");
  if (!s)
    return (
      <Screen title={MONEY.title} lead={MONEY.lead}>
        <Loading />
      </Screen>
    );
  const spent = s.spends.reduce((n, x) => n + x.cents, 0);
  const pct = s.budgetCents > 0 ? Math.min(100, Math.round((spent / s.budgetCents) * 100)) : 0;
  const byKind = MONEY_KINDS.map((k) => ({ k, cents: s.spends.filter((x) => x.category === k).reduce((n, x) => n + x.cents, 0) })).filter((x) => x.cents > 0);

  const saveBudget = (e: FormEvent) => {
    e.preventDefault();
    const c = toCents(budget);
    if (c === null) return setBudgetErr(MONEY.budgetErr);
    setBudgetErr("");
    moreStore.update((st) => ({ ...st, budgetCents: c }));
    setBudget("");
  };
  const addSpend = (e: FormEvent) => {
    e.preventDefault();
    const c = toCents(amount);
    if (!what.trim() || c === null || c <= 0) return setAddErr(MONEY.addErr);
    setAddErr("");
    moreStore.update((st) => ({ ...st, spends: [{ id: newId(), cents: c, category: kind, note: what.trim().slice(0, 120), date: todayIso() }, ...st.spends] }));
    setWhat("");
    setAmount("");
  };

  return (
    <Screen title={MONEY.title} lead={MONEY.lead}>
      <PreviewNote />
      <NeedsJs>
        <Card className="grid gap-3">
          <p className="m-0 text-xl font-bold">
            {s.budgetCents > 0 ? fill(MONEY.spentOf, { spent: usd(spent), budget: usd(s.budgetCents) }) : fill(MONEY.spentOnly, { spent: usd(spent) })}
          </p>
          {s.budgetCents > 0 ? (
            <>
              <div
                role="img"
                aria-label={fill(MONEY.barLabel, { pct })}
                className="h-4 overflow-hidden rounded-full border border-line-strong bg-lav"
              >
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <p className="m-0 font-semibold">
                {spent <= s.budgetCents ? fill(MONEY.left, { left: usd(s.budgetCents - spent) }) : fill(MONEY.over, { over: usd(spent - s.budgetCents) })}
              </p>
            </>
          ) : (
            <p className="m-0 text-muted-ink">{MONEY.noBudget}</p>
          )}
        </Card>

        <Section title={MONEY.addTitle}>
          <form onSubmit={addSpend} className="grid gap-4">
            <Field id={ids.what} label={MONEY.whatLabel}>
              <input className={fieldControlClass} value={what} maxLength={120} onChange={(e) => setWhat(e.target.value)} />
            </Field>
            <Field id={ids.amount} label={MONEY.amountLabel} hint={MONEY.amountHint} error={addErr || undefined}>
              <input className={fieldControlClass} inputMode="decimal" value={amount} maxLength={12} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Segmented label={MONEY.categoryLegend} showLabel value={kind} onValueChange={setKind} options={MONEY_KINDS.map((k) => ({ value: k, label: k }))} />
            <Button kind="primary" type="submit">
              {MONEY.add}
            </Button>
          </form>
        </Section>

        <Section title={MONEY.weekTitle}>
          {s.spends.length === 0 ? (
            <p className="m-0 text-muted-ink">{MONEY.nothing}</p>
          ) : (
            <ul className="m-0 grid gap-2 p-0">
              {s.spends.map((x) => (
                <li key={x.id} className="flex list-none items-center justify-between gap-3 rounded-card border border-line bg-surface p-3">
                  <span>
                    <span className="block font-semibold">{x.note}</span>
                    <span className="text-sm text-muted-ink">{x.category}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold tabular-nums">{usd(x.cents)}</span>
                    <Button kind="tertiary" className="min-h-9 text-sm" onClick={() => moreStore.update((st) => ({ ...st, spends: st.spends.filter((y) => y.id !== x.id) }))}>
                      {MONEY.remove}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {byKind.length > 0 ? (
          <Section title={MONEY.byKind}>
            <Card>
              <dl className="m-0 grid gap-2">
                {byKind.map((x) => (
                  <div key={x.k} className="flex justify-between gap-3">
                    <dt>{x.k}</dt>
                    <dd className="m-0 font-bold tabular-nums">{usd(x.cents)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </Section>
        ) : null}

        <Section title={MONEY.budgetTitle}>
          <form onSubmit={saveBudget} className="grid gap-3">
            <Field id={ids.budget} label={MONEY.budgetLabel} hint={MONEY.budgetHint} error={budgetErr || undefined}>
              <input className={fieldControlClass} inputMode="decimal" value={budget} maxLength={12} onChange={(e) => setBudget(e.target.value)} />
            </Field>
            <Button kind="secondary" type="submit">
              {MONEY.budgetSave}
            </Button>
          </form>
        </Section>

        {s.spends.length > 0 ? (
          <div className="mt-8">
            <ConfirmDelete
              label={MONEY.newWeek}
              note={MONEY.newWeekNote}
              confirm={MONEY.newWeekConfirm}
              cancel={MONEY.newWeekCancel}
              onConfirm={() => moreStore.update((st) => ({ ...st, spends: [] }))}
            />
          </div>
        ) : null}
      </NeedsJs>
    </Screen>
  );
}
