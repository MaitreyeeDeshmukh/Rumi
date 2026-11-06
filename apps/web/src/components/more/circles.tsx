"use client";

import { useId, useState, type FormEvent } from "react";
import { Card, CheckRow, LinkCard, Loading, NeedsJs, NotFound, PreviewNote, Section } from "@/components/more/parts";
import { Button, ButtonLink } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Check } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import {
  CIRCLES,
  COMFORT_PREFS,
  COMM_STYLES,
  EVENTS,
  GROUPS,
  PREP_ITEMS,
  REPORT_REASONS,
  SEED_MESSAGES,
  type CircleEvent,
  type Group,
} from "@/content/circles";
import { addDaysIso, clockTime, longDate, moreStore, newId, useMore, type Circles } from "@/features/more/store";
import { fill } from "@/lib/fill";

const groupById = (id: string): Group | undefined => GROUPS.find((g) => g.id === id);
const eventById = (id: string): CircleEvent | undefined => EVENTS.find((e) => e.id === id);

/** The event's date. inDays -1 is the next Saturday (1 to 7 days away). */
export function eventDate(e: CircleEvent): string {
  if (e.inDays >= 0) return addDaysIso(e.inDays);
  const day = new Date().getDay();
  return addDaysIso(((6 - day + 7) % 7) || 7);
}

const eventWhen = (e: CircleEvent): string => `${longDate(eventDate(e))} · ${clockTime(e.time)} to ${clockTime(e.end)}`;

const setCircles = (fn: (c: Circles) => Circles) => moreStore.update((st) => ({ ...st, circles: fn(st.circles) }));

function GroupCard({ g, joined }: { g: Group; joined: boolean }) {
  return (
    <LinkCard
      href={`/home/circles/group/${g.id}`}
      title={g.name}
      text={`${g.desc} ${g.mode} · ${fill(CIRCLES.members, { n: g.members })}`}
      tag={joined ? CIRCLES.mine : undefined}
    />
  );
}

/** /home/circles: browse circles, filter by how people like to talk, and see your next meetups. */
export function CirclesHome() {
  const s = useMore();
  const [view, setView] = useState("all");
  const [style, setStyle] = useState("any");
  if (!s)
    return (
      <Screen title={CIRCLES.title} lead={CIRCLES.lead}>
        <Loading />
      </Screen>
    );
  const joined = s.circles.joined;
  const list = GROUPS.filter((g) => (view === "mine" ? joined.includes(g.id) : true)).filter((g) => style === "any" || g.comm.includes(style));
  const mine = EVENTS.filter((e) => s.circles.going.includes(e.id));
  return (
    <Screen title={CIRCLES.title} lead={CIRCLES.lead}>
      <PreviewNote>{CIRCLES.preview}</PreviewNote>
      <NeedsJs>
        {mine.length > 0 ? (
          <Section title={CIRCLES.comingUp} className="mt-0 mb-8">
            {mine.map((e) => (
              <LinkCard key={e.id} href={`/home/circles/event/${e.id}`} title={e.title} text={eventWhen(e)} tag={CIRCLES.going} />
            ))}
          </Section>
        ) : null}
        <div className="grid gap-4">
          <Segmented
            label={CIRCLES.view}
            value={view}
            onValueChange={setView}
            options={[
              { value: "all", label: CIRCLES.all },
              { value: "mine", label: CIRCLES.mine },
            ]}
          />
          <Segmented
            label={CIRCLES.styleLegend}
            showLabel
            value={style}
            onValueChange={setStyle}
            options={[{ value: "any", label: CIRCLES.any }, ...COMM_STYLES.map((c) => ({ value: c, label: c }))]}
          />
        </div>
        <div className="mt-6 grid gap-3">
          {list.map((g) => (
            <GroupCard key={g.id} g={g} joined={joined.includes(g.id)} />
          ))}
          {list.length === 0 ? <EmptyState title={view === "mine" && style === "any" ? CIRCLES.noneJoined : CIRCLES.noneMatch} /> : null}
        </div>
        <Section title={CIRCLES.comfortLink}>
          <LinkCard href="/home/circles/comfort" title={CIRCLES.comfortLink} text={CIRCLES.comfortText} />
        </Section>
      </NeedsJs>
    </Screen>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="m-0 grid gap-2 p-0">
      {items.map((r) => (
        <li key={r} className="flex list-none items-start gap-2">
          <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <span>{r}</span>
        </li>
      ))}
    </ul>
  );
}

/** /home/circles/group/:id */
export function GroupDetail({ id }: { id: string }) {
  const s = useMore();
  const [said, setSaid] = useState("");
  const g = groupById(id);
  if (!g)
    return (
      <Screen title={CIRCLES.title} lead={CIRCLES.lead}>
        <NotFound />
      </Screen>
    );
  const on = !!s && s.circles.joined.includes(g.id);
  const evs = EVENTS.filter((e) => e.groupId === g.id);
  return (
    <Screen title={g.name} lead={g.desc}>
      <PreviewNote>{CIRCLES.preview}</PreviewNote>
      <NeedsJs>
        <div className="flex flex-wrap gap-2">
          <Chip>{g.mode}</Chip>
          <Chip>{g.size}</Chip>
          {g.comm.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </div>
        {!s ? (
          <Loading />
        ) : (
          <div className="mt-6 grid gap-3">
            {on ? (
              <ButtonLink kind="primary" href={`/home/circles/chat/${g.id}`} block arrow>
                {CIRCLES.openChat}
              </ButtonLink>
            ) : null}
            <Button
              kind={on ? "secondary" : "primary"}
              block
              onClick={() => {
                setCircles((c) => ({ ...c, joined: on ? c.joined.filter((x) => x !== g.id) : [...c.joined, g.id] }));
                setSaid(on ? CIRCLES.left : CIRCLES.joined);
              }}
            >
              {on ? CIRCLES.leave : CIRCLES.join}
            </Button>
            <p role="status" className="m-0 min-h-6 text-ink">
              {said}
            </p>
          </div>
        )}
        <Section title={CIRCLES.events}>
          {evs.length === 0 ? (
            <p className="m-0 text-muted-ink">{CIRCLES.noEvents}</p>
          ) : (
            evs.map((e) => <LinkCard key={e.id} href={`/home/circles/event/${e.id}`} title={e.title} text={eventWhen(e)} />)
          )}
        </Section>
        <Section title={CIRCLES.rules}>
          <Card>
            <Bullets items={g.rules} />
          </Card>
        </Section>
        <Section title={CIRCLES.people}>
          <p className="m-0 text-sm text-muted-ink">{CIRCLES.peopleNote}</p>
          <div className="flex flex-wrap gap-2">
            {g.people.map((p) => (
              <Chip key={p}>{p}</Chip>
            ))}
          </div>
        </Section>
      </NeedsJs>
    </Screen>
  );
}

const ago = (ts: number): string => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return CIRCLES.justNow;
  return mins < 60 ? fill(CIRCLES.minutesAgo, { n: mins }) : fill(CIRCLES.hoursAgo, { n: Math.round(mins / 60) });
};

type Msg = { key: string; user: string; text: string; ts: number; mine: boolean; demo: boolean };

function ReportBox({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 grid gap-3 rounded-card border-2 border-line-strong bg-surface p-3">
      <Segmented label={CIRCLES.reportTitle} showLabel value={reason} onValueChange={setReason} options={REPORT_REASONS.map((r) => ({ value: r, label: r }))} />
      <p className="m-0 text-sm text-muted-ink">{CIRCLES.reportNote}</p>
      <div className="flex flex-wrap gap-3">
        <Button kind="primary" disabled={!reason} onClick={onDone}>
          {CIRCLES.reportSave}
        </Button>
        <Button kind="secondary" onClick={onCancel}>
          {CIRCLES.reportCancel}
        </Button>
      </div>
    </div>
  );
}

/** /home/circles/chat/:id: made-up messages, your own messages, ideas to start, and reporting. */
export function GroupChat({ id }: { id: string }) {
  const s = useMore();
  const inputId = useId();
  const [text, setText] = useState("");
  const [reporting, setReporting] = useState("");
  const [now] = useState(() => Date.now());
  const g = groupById(id);
  const title = g ? fill(CIRCLES.chatTitle, { name: g.name }) : CIRCLES.title;
  if (!g)
    return (
      <Screen title={title} lead={CIRCLES.lead}>
        <NotFound />
      </Screen>
    );
  if (!s)
    return (
      <Screen title={title} lead={CIRCLES.chatLead}>
        <Loading />
      </Screen>
    );
  if (!s.circles.joined.includes(g.id))
    return (
      <Screen title={title} lead={CIRCLES.chatLead}>
        <EmptyState
          title={CIRCLES.joinToChat}
          action={
            <Button kind="primary" onClick={() => setCircles((c) => ({ ...c, joined: [...c.joined, g.id] }))}>
              {CIRCLES.join}
            </Button>
          }
        />
      </Screen>
    );

  const msgs: Msg[] = [
    ...(SEED_MESSAGES[g.id] ?? []).map((m) => ({ key: `${g.id}:${m.id}`, user: m.user, text: m.text, ts: now - m.minsAgo * 60000, mine: false, demo: false })),
    ...(s.circles.sent[g.id] ?? []).map((m) => ({ key: `${g.id}:${m.id}`, user: m.mine ? CIRCLES.you : g.people[0] ?? "", text: m.text, ts: m.ts, mine: m.mine, demo: !m.mine })),
  ].sort((a, b) => a.ts - b.ts);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const first = !(s.circles.sent[g.id] ?? []).some((m) => !m.mine);
    setCircles((c) => ({ ...c, sent: { ...c.sent, [g.id]: [...(c.sent[g.id] ?? []), { id: newId(), text: t.slice(0, 1000), ts: Date.now(), mine: true }] } }));
    setText("");
    if (first)
      setTimeout(
        () => setCircles((c) => ({ ...c, sent: { ...c.sent, [g.id]: [...(c.sent[g.id] ?? []), { id: newId(), text: g.welcome, ts: Date.now(), mine: false }] } })),
        1200,
      );
  };

  return (
    <Screen title={title} lead={CIRCLES.chatLead}>
      <PreviewNote>{CIRCLES.preview}</PreviewNote>
      <ol className="m-0 grid gap-3 p-0" aria-live="polite">
        {msgs.map((m) =>
          s.circles.reported.includes(m.key) ? (
            <li key={m.key} className="list-none rounded-card border border-dashed border-line-strong p-3 text-sm text-muted-ink">
              {CIRCLES.reported}
            </li>
          ) : (
            <li
              key={m.key}
              className={m.mine ? "ml-8 list-none rounded-card border border-primary bg-primary-soft p-3" : "mr-8 list-none rounded-card border border-line bg-surface p-3"}
            >
              <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold">{m.user}</span>
                <span className="text-muted-ink">{ago(m.ts)}</span>
                {m.demo ? <Chip className="min-h-6 text-xs">{CIRCLES.demoReply}</Chip> : null}
              </p>
              <p className="m-0 mt-1">{m.text}</p>
              {!m.mine ? (
                reporting === m.key ? (
                  <ReportBox
                    onCancel={() => setReporting("")}
                    onDone={() => {
                      setCircles((c) => ({ ...c, reported: [...c.reported, m.key] }));
                      setReporting("");
                    }}
                  />
                ) : (
                  <Button kind="tertiary" className="mt-1 min-h-9 text-sm" onClick={() => setReporting(m.key)}>
                    {CIRCLES.report}
                  </Button>
                )
              ) : null}
            </li>
          ),
        )}
      </ol>
      <Section title={CIRCLES.starters}>
        <div className="flex flex-wrap gap-2">
          {g.starters.map((t) => (
            <Button key={t} kind="secondary" className="min-h-11 text-base font-semibold" onClick={() => setText(t)}>
              {t}
            </Button>
          ))}
        </div>
      </Section>
      <form onSubmit={send} className="mt-6 grid gap-3">
        <Field id={inputId} label={CIRCLES.messageLabel}>
          <textarea className={fieldControlClass} rows={2} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Button kind="primary" type="submit" disabled={!text.trim()}>
          {CIRCLES.send}
        </Button>
      </form>
    </Screen>
  );
}

/** /home/circles/event/:id */
export function EventDetail({ id }: { id: string }) {
  const s = useMore();
  const e = eventById(id);
  const g = e ? groupById(e.groupId) : undefined;
  if (!e || !g)
    return (
      <Screen title={CIRCLES.title} lead={CIRCLES.lead}>
        <NotFound />
      </Screen>
    );
  const going = !!s && s.circles.going.includes(e.id);
  return (
    <Screen title={e.title} lead={g.name}>
      <PreviewNote>{CIRCLES.preview}</PreviewNote>
      <NeedsJs>
        <Card>
          <dl className="m-0 grid gap-3">
            {[
              [CIRCLES.when, eventWhen(e)],
              [CIRCLES.where, e.where],
              [CIRCLES.activity, e.activity],
              [CIRCLES.size, e.size],
            ].map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-sm font-bold text-muted-ink">{k}</dt>
                <dd className="m-0">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {s ? (
          <div className="mt-6 grid gap-3">
            <Segmented
              label={CIRCLES.rsvp}
              showLabel
              value={going ? "yes" : "no"}
              onValueChange={(v) => setCircles((c) => ({ ...c, going: v === "yes" ? [...c.going.filter((x) => x !== e.id), e.id] : c.going.filter((x) => x !== e.id) }))}
              options={[
                { value: "yes", label: CIRCLES.going },
                { value: "no", label: CIRCLES.notGoing },
              ]}
            />
            <p role="status" className="m-0 min-h-6 text-ink">
              {going ? CIRCLES.goingNote : ""}
            </p>
            <ButtonLink kind="primary" href={`/home/circles/prep/${e.id}`} block arrow>
              {CIRCLES.prep}
            </ButtonLink>
          </div>
        ) : null}
        <Section title={CIRCLES.bring}>
          <Card>
            <Bullets items={e.bring} />
          </Card>
        </Section>
        <Section title={CIRCLES.expect}>
          <Card>
            <ol className="m-0 grid gap-2 pl-5">
              {e.expect.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </Card>
        </Section>
        <Section title={CIRCLES.leaveEarly}>
          <Notice tone="success">
            <p className="m-0">{e.leave}</p>
          </Notice>
        </Section>
        <Section title={CIRCLES.access}>
          <div className="flex flex-wrap gap-2">
            {e.access.map((a) => (
              <Chip key={a}>{a}</Chip>
            ))}
          </div>
        </Section>
      </NeedsJs>
    </Screen>
  );
}

/** /home/circles/prep/:id: a checklist, things you could say, and how to leave. */
export function MeetupPrep({ id }: { id: string }) {
  const s = useMore();
  const e = eventById(id);
  const g = e ? groupById(e.groupId) : undefined;
  if (!e || !g)
    return (
      <Screen title={CIRCLES.prepTitle} lead={CIRCLES.prepLead}>
        <NotFound />
      </Screen>
    );
  const items = [...PREP_ITEMS.slice(0, 2), ...e.bring, ...PREP_ITEMS.slice(2)];
  const done = s?.circles.prepDone[e.id] ?? [];
  const toggle = (item: string, on: boolean) =>
    setCircles((c) => {
      const cur = c.prepDone[e.id] ?? [];
      return { ...c, prepDone: { ...c.prepDone, [e.id]: on ? [...cur.filter((x) => x !== item), item] : cur.filter((x) => x !== item) } };
    });
  return (
    <Screen title={CIRCLES.prepTitle} lead={`${e.title} · ${eventWhen(e)}`}>
      <PreviewNote>{CIRCLES.prepLead}</PreviewNote>
      <NeedsJs>
        {!s ? (
          <Loading />
        ) : (
          <Section title={CIRCLES.checklist} className="mt-0">
            <p className="m-0 text-muted-ink" role="status">
              {fill(CIRCLES.doneOf, { done: items.filter((i) => done.includes(i)).length, total: items.length })}
            </p>
            {items.map((i) => (
              <CheckRow key={i} label={i} checked={done.includes(i)} onChange={(on) => toggle(i, on)} />
            ))}
          </Section>
        )}
        <Section title={CIRCLES.startersOptional}>
          <Card>
            <Bullets items={g.starters} />
          </Card>
        </Section>
        <Section title={CIRCLES.leaveEarly}>
          <Notice tone="success">
            <p className="m-0">{e.leave}</p>
          </Notice>
        </Section>
      </NeedsJs>
    </Screen>
  );
}

/** /home/circles/comfort: how you like to connect. */
export function Comfort() {
  const s = useMore();
  const [saved, setSaved] = useState(false);
  return (
    <Screen title={CIRCLES.comfortTitle} lead={CIRCLES.comfortLead}>
      <PreviewNote>{CIRCLES.preview}</PreviewNote>
      <NeedsJs>
        {!s ? (
          <Loading />
        ) : (
          <div className="grid gap-3">
            {COMFORT_PREFS.map((p) => (
              <CheckRow
                key={p}
                label={p}
                checked={s.circles.comfort.includes(p)}
                onChange={(on) => {
                  setCircles((c) => ({ ...c, comfort: on ? [...c.comfort.filter((x) => x !== p), p] : c.comfort.filter((x) => x !== p) }));
                  setSaved(true);
                }}
              />
            ))}
            <p role="status" className="m-0 min-h-6 text-ink">
              {saved ? CIRCLES.comfortSaved : ""}
            </p>
          </div>
        )}
      </NeedsJs>
    </Screen>
  );
}
