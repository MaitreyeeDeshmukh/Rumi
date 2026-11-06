"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { Screen } from "@/components/ui/screen";
import { SETTINGS } from "@/content/settings";
import { WELCOME } from "@/content/welcome";
import { forgetMemory } from "@/features/shims/memory";
import type { RumiState, Settings, ThemeName } from "@/features/shims/types";
import { announce } from "@/lib/announce";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";
import { THEMES } from "@/lib/theme";

const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-4 border-0 border-t border-line p-0 pt-5">
      <legend className="mb-1 p-0 text-xl font-bold text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** /settings: every control saves at once. No primary button. */
export function SettingsScreen() {
  const page = PAGES["/settings"];
  const { state, update, reset, hydrated, persisted } = useRumi();
  const router = useRouter();
  const id = useId();
  const s = state.settings;
  const [touched, setTouched] = useState(false);
  const [sheet, setSheet] = useState(null as "forget" | "erase" | null);

  // One place for every change: write it, then tell the person (a sentence for sighted people, a live region for others).
  const save = (fn: (draft: RumiState) => void) => {
    update(fn);
    setTouched(true);
  };
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    save((d) => {
      d.settings[key] = value;
    });

  const facts = state.persona.facts;

  const erase = () => {
    setSheet(null);
    if (s.memoryOptIn) forgetMemory(update); // swap when the lane merges: forgetAll(), then reset()
    reset();
    announce(SETTINGS.deleted);
    router.push("/welcome");
  };

  return (
    <Screen title={page.h1} lead={page.lead}>
      <div data-needs-js className="grid gap-8">
        <p role="status" className="note m-0 min-h-6">
          {touched ? (persisted ? SETTINGS.saved : SETTINGS.notSaved) : ""}
        </p>
        <div className="grid gap-8">
          <Group legend={SETTINGS.about.legend}>
            <Field id={`${id}-name`} label={SETTINGS.about.name}>
              <input
                type="text"
                autoComplete="given-name"
                maxLength={40}
                disabled={!hydrated}
                className={fieldControlClass}
                value={s.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field id={`${id}-helper`} label={SETTINGS.about.helper}>
              <input
                type="text"
                maxLength={30}
                disabled={!hydrated}
                className={fieldControlClass}
                value={s.companionName}
                onChange={(e) => set("companionName", e.target.value)}
                onBlur={(e) => {
                  if (!e.target.value.trim()) set("companionName", WELCOME.helperDefault);
                }}
              />
            </Field>
          </Group>

          <Group legend={SETTINGS.reading.legend}>
            <Segmented
              label={SETTINGS.reading.output}
              value={s.outputMode}
              onValueChange={(v) => set("outputMode", v as Settings["outputMode"])}
              options={options(WELCOME.output)}
            />
            <Segmented
              label={SETTINGS.reading.detail}
              value={s.detail}
              onValueChange={(v) => set("detail", v as Settings["detail"])}
              options={options(WELCOME.detail)}
            />
          </Group>

          <Group legend={SETTINGS.look.legend}>
            <ChoiceGroup
              aria-label={SETTINGS.look.theme}
              value={hydrated ? s.theme : ""}
              onValueChange={(v) => set("theme", v as ThemeName)}
            >
              {THEMES.map((t) => (
                <ChoiceCard key={t.id} value={t.id} title={t.label}>
                  {WELCOME.lookHint[t.id]}
                </ChoiceCard>
              ))}
            </ChoiceGroup>
            <Segmented
              label={SETTINGS.look.size}
              value={String(s.textScale)}
              onValueChange={(v) => set("textScale", Number(v) as Settings["textScale"])}
              options={SETTINGS.look.sizes}
            />
            <Toggle
              label={SETTINGS.look.reduce}
              hint={SETTINGS.look.reduceHint}
              checked={s.reducedMotion}
              onCheckedChange={(v) => set("reducedMotion", v)}
            />
          </Group>

          <Group legend={SETTINGS.sound.legend}>
            <Toggle label={SETTINGS.sound.label} checked={s.finishSound} onCheckedChange={(v) => set("finishSound", v)} />
          </Group>

          <Group legend={SETTINGS.memory.legend}>
            <h2 className="m-0 text-base">{SETTINGS.memory.title}</h2>
            {SETTINGS.memory.body.map((line) => (
              <p key={line} className="m-0">
                {line}
              </p>
            ))}
            <Toggle
              label={SETTINGS.memory.toggle}
              checked={s.memoryOptIn}
              onCheckedChange={(v) => set("memoryOptIn", v)}
            />
            {s.memoryOptIn ? (
              <div className="grid gap-3">
                <h3 className="m-0 text-base">{SETTINGS.memory.remembers}</h3>
                {facts.length ? (
                  <ul className="m-0 grid gap-1 pl-5">
                    {facts.map((f) => (
                      <li key={f.id}>{f.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0">{SETTINGS.memory.nothing}</p>
                )}
              </div>
            ) : null}
            <div>
              <Button kind="secondary" onClick={() => setSheet("forget")}>
                {SETTINGS.memory.forget}
              </Button>
            </div>
          </Group>

          <Group legend={SETTINGS.data.legend}>
            <ul className="m-0 grid list-none gap-2 p-0">
              {SETTINGS.data.rows.map((row) => (
                <li key={row.label}>
                  <strong>{row.label}.</strong> {row.text}
                </li>
              ))}
            </ul>
          </Group>

          <Group legend={SETTINGS.erase.legend}>
            <p className="m-0">{SETTINGS.erase.body}</p>
            <div>
              <Button kind="secondary" onClick={() => setSheet("erase")}>
                {SETTINGS.erase.open}
              </Button>
            </div>
          </Group>
        </div>
      </div>

      <Sheet open={sheet === "forget"} onOpenChange={(o) => !o && setSheet(null)} title={SETTINGS.memory.forgetTitle}>
        <p className="m-0">{SETTINGS.memory.forgetBody}</p>
        <div className="grid gap-3">
          <Button
            kind="danger"
            onClick={() => {
              forgetMemory(update);
              setTouched(true);
              setSheet(null);
            }}
          >
            {SETTINGS.memory.confirmForget}
          </Button>
          <Button kind="secondary" onClick={() => setSheet(null)}>
            {SETTINGS.memory.keep}
          </Button>
        </div>
      </Sheet>
      <Sheet open={sheet === "erase"} onOpenChange={(o) => !o && setSheet(null)} title={SETTINGS.erase.title}>
        <p className="m-0">{SETTINGS.erase.warning}</p>
        <div className="grid gap-3">
          <Button kind="danger" onClick={erase}>
            {SETTINGS.erase.confirm}
          </Button>
          <Button kind="secondary" onClick={() => setSheet(null)}>
            {SETTINGS.erase.cancel}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
