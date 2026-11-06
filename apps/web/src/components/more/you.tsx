"use client";

import { useId, useState, type FormEvent } from "react";
import { Card, ConfirmDelete, Loading, NeedsJs, PreviewNote, Section } from "@/components/more/parts";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldControlClass } from "@/components/ui/field";
import { MessageCircle, Phone } from "lucide-react";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { CONTACTS, GROWTH } from "@/content/you";
import { longDate, moreStore, newId, todayIso, useMore, type Contact } from "@/features/more/store";
import { fill } from "@/lib/fill";
import { useRumi } from "@/lib/rumiActive";

/** A phone link value: digits and a leading plus only. */
export const telValue = (phone: string): string => phone.replace(/[^\d+]/g, "");

/** Text and call links for one contact. Used here and by Rescue. */
export function ReachButtons({ c }: { c: Contact }) {
  const tel = telValue(c.phone);
  const text = (
    <ButtonLink kind={c.how === "text" ? "primary" : "secondary"} href={`sms:${tel}`}>
      <MessageCircle aria-hidden="true" className="size-5" />
      {fill(CONTACTS.textThem, { name: c.name })}
    </ButtonLink>
  );
  const call = (
    <ButtonLink kind={c.how === "call" ? "primary" : "secondary"} href={`tel:${tel}`}>
      <Phone aria-hidden="true" className="size-5" />
      {fill(CONTACTS.callThem, { name: c.name })}
    </ButtonLink>
  );
  return <div className="grid gap-3 sm:flex sm:flex-wrap">{c.how === "text" ? (
        <>
          {text}
          {call}
        </>
      ) : (
        <>
          {call}
          {text}
        </>
      )}</div>;
}

function AddContact({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const ids = { name: useId(), relation: useId(), phone: useId() };
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [phone, setPhone] = useState("");
  const [how, setHow] = useState("text");
  const [err, setErr] = useState({} as { name?: string; phone?: string });
  const save = (e: FormEvent) => {
    e.preventDefault();
    const next = { name: name.trim() ? undefined : CONTACTS.errName, phone: telValue(phone).length >= 3 ? undefined : CONTACTS.errPhone };
    setErr(next);
    if (next.name || next.phone) return;
    moreStore.update((st) => ({
      ...st,
      contacts: [...st.contacts, { id: newId(), name: name.trim(), relation: relation.trim(), phone: phone.trim(), how: how === "call" ? "call" : "text" }],
    }));
    onDone();
  };
  return (
    <form onSubmit={save} className="grid gap-4 rounded-card border-2 border-line-strong bg-surface p-4">
      <h2 className="m-0 text-[1.25rem]">{CONTACTS.addTitle}</h2>
      <Field id={ids.name} label={CONTACTS.name} error={err.name}>
        <input className={fieldControlClass} value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id={ids.relation} label={CONTACTS.relation} hint={CONTACTS.relationHint}>
        <input className={fieldControlClass} value={relation} maxLength={80} onChange={(e) => setRelation(e.target.value)} />
      </Field>
      <Field id={ids.phone} label={CONTACTS.phone} hint={CONTACTS.phoneHint} error={err.phone}>
        <input className={fieldControlClass} type="tel" inputMode="tel" autoComplete="off" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Segmented
        label={CONTACTS.howLegend}
        showLabel
        value={how}
        onValueChange={setHow}
        options={[
          { value: "text", label: CONTACTS.text },
          { value: "call", label: CONTACTS.call },
        ]}
      />
      <div className="grid gap-3 sm:flex">
        <Button kind="primary" type="submit">
          {CONTACTS.save}
        </Button>
        {canCancel ? (
          <Button kind="secondary" onClick={onDone}>
            {CONTACTS.cancel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** /home/contacts: the people you might reach fast, with text and call links. */
export function Contacts() {
  const s = useMore();
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState("");
  return (
    <Screen title={CONTACTS.title} lead={CONTACTS.lead}>
      <PreviewNote>{CONTACTS.note}</PreviewNote>
      <NeedsJs>
        {!s ? (
          <Loading />
        ) : (
          <div className="grid gap-4">
            {s.contacts.map((c) => (
              <Card key={c.id} className="grid gap-3">
                <p className="m-0">
                  <span className="block text-lg font-bold">{c.name}</span>
                  {c.relation ? <span className="text-muted-ink">{c.relation}</span> : null}
                </p>
                <ReachButtons c={c} />
                <ConfirmDelete
                  label={CONTACTS.remove}
                  confirm={CONTACTS.removeConfirm}
                  cancel={CONTACTS.removeCancel}
                  note={fill(CONTACTS.removeNote, { name: c.name })}
                  onConfirm={() => moreStore.update((st) => ({ ...st, contacts: st.contacts.filter((x) => x.id !== c.id) }))}
                />
              </Card>
            ))}
            {s.contacts.length === 0 && !adding ? <EmptyState title={CONTACTS.emptyTitle}>{CONTACTS.emptyText}</EmptyState> : null}
            {adding ? (
              <AddContact
                canCancel
                onDone={() => {
                  setAdding(false);
                  setSaid(CONTACTS.saved);
                }}
              />
            ) : (
              <Button
                kind="primary"
                block
                onClick={() => {
                  setAdding(true);
                  setSaid("");
                }}
              >
                {CONTACTS.add}
              </Button>
            )}
            <p role="status" className="m-0 min-h-6 text-ink">
              {said}
            </p>
          </div>
        )}
      </NeedsJs>
    </Screen>
  );
}

function Tile({ n, label }: { n: number; label: string }) {
  return (
    <div className="grid gap-1 rounded-card border border-line bg-sage p-4 text-ink">
      <span className="text-3xl font-bold tabular-nums">{n}</span>
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

/** /home/growth: counts of things done, from the main app and the previews, plus small wins you write down. */
export function Growth() {
  const s = useMore();
  const { state, hydrated } = useRumi();
  const winId = useId();
  const [win, setWin] = useState("");
  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = win.trim();
    if (!t) return;
    moreStore.update((st) => ({ ...st, wins: [{ id: newId(), text: t.slice(0, 300), date: todayIso() }, ...st.wins] }));
    setWin("");
  };
  return (
    <Screen title={GROWTH.title} lead={GROWTH.lead}>
      <PreviewNote>{GROWTH.only}</PreviewNote>
      <NeedsJs>
        {!s || !hydrated ? (
          <Loading />
        ) : (
          <>
            <Section title={GROWTH.countsTitle} className="mt-0">
              <div className="grid grid-cols-2 gap-3">
                <Tile n={state.sessions.length} label={GROWTH.practices} />
                <Tile n={s.visits.length} label={GROWTH.visits} />
                <Tile n={s.appointments.filter((a) => a.done).length} label={GROWTH.appointments} />
                <Tile n={s.circles.going.length} label={GROWTH.meetups} />
                <Tile n={s.tasks.filter((t) => t.done).length} label={GROWTH.tasks} />
              </div>
            </Section>
            <Section title={GROWTH.winsTitle}>
              <p className="m-0 text-muted-ink">{GROWTH.winsLead}</p>
              <form onSubmit={add} className="grid gap-3">
                <Field id={winId} label={GROWTH.winLabel}>
                  <input className={fieldControlClass} value={win} maxLength={300} onChange={(e) => setWin(e.target.value)} />
                </Field>
                <Button kind="primary" type="submit" disabled={!win.trim()}>
                  {GROWTH.addWin}
                </Button>
              </form>
              {s.wins.length === 0 ? (
                <p className="m-0 text-muted-ink">{GROWTH.emptyWins}</p>
              ) : (
                <ul className="m-0 grid gap-3 p-0">
                  {s.wins.map((w) => (
                    <li key={w.id} className="flex list-none items-start justify-between gap-3 rounded-card border border-line bg-surface p-3">
                      <span>
                        <span className="block">{w.text}</span>
                        <span className="text-sm text-muted-ink">{longDate(w.date)}</span>
                      </span>
                      <Button kind="tertiary" className="min-h-9 text-sm" onClick={() => moreStore.update((st) => ({ ...st, wins: st.wins.filter((x) => x.id !== w.id) }))}>
                        {GROWTH.removeWin}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
      </NeedsJs>
    </Screen>
  );
}
