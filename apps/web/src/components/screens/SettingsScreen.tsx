"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { ThemeSwatch } from "@/components/ui/theme-swatch";
import { Sheet } from "@/components/ui/sheet";
import { Toggle } from "@/components/ui/toggle";
import { Screen } from "@/components/ui/screen";
import { SETTINGS } from "@/content/settings";
import { useAuth } from "@/features/auth/AuthProvider";
import { getBrowserClient } from "@/lib/supabase/browser";
import { WELCOME } from "@/content/welcome";
import { MEMORY_COPY } from "@/features/memory/consentCopy";
import { useMemoryControls } from "@/features/memory/useMemoryControls";
import type { RumiState, Settings, ThemeName } from "@/features/shared/types";
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
  const { state, update, hydrated, lastSave, readOnly } = useRumi();
  const persisted = lastSave.ok && !readOnly;
  const { actions, facts } = useMemoryControls();
  const [memoryNote, setMemoryNote] = useState("");
  const router = useRouter();
  const { status, isAnonymous } = useAuth();
  const [accountNote, setAccountNote] = useState("");
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

  // The memory switch talks to the server first and flips only when that worked, so it never shows a state that is not true.
  const toggleMemory = async (on: boolean) => {
    setMemoryNote("");
    const res = await (on ? actions.enableMemory() : actions.disableMemory());
    setTouched(true);
    setMemoryNote(res.ok ? (res.remote === "paused" ? MEMORY_COPY.paused : MEMORY_COPY.saved) : res.remote === "paused" ? MEMORY_COPY.paused : MEMORY_COPY.failed);
  };
  const forget = async () => {
    setSheet(null);
    const res = await actions.forgetAll();
    setMemoryNote(res.remote === "failed" ? MEMORY_COPY.forgetFailed : res.remote === "paused" ? MEMORY_COPY.paused : MEMORY_COPY.saved);
    setTouched(true);
  };

  // Ends the session on this device only, then goes to the home page. Saved settings on this device stay as they are.
  const signOut = async () => {
    setAccountNote("");
    try {
      const { error } = await getBrowserClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      router.push("/");
    } catch {
      setAccountNote(SETTINGS.account.failed);
    }
  };

  const erase = async () => {
    setSheet(null);
    const res = await actions.deleteEverything();
    if (res.status !== "ok") {
      setMemoryNote(res.status === "paused" ? MEMORY_COPY.paused : MEMORY_COPY.forgetFailed);
      return;
    }
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
              showLabel
              label={SETTINGS.reading.output}
              value={s.outputMode}
              onValueChange={(v) => set("outputMode", v as Settings["outputMode"])}
              options={options(WELCOME.output)}
            />
            <Segmented
              showLabel
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
                  <ThemeSwatch theme={t.id} />
                  <span className="block">{WELCOME.lookHint[t.id]}</span>
                </ChoiceCard>
              ))}
            </ChoiceGroup>
            <Segmented
              showLabel
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
              onCheckedChange={(v) => void toggleMemory(v)}
            />
            <p role="status" className="note m-0 min-h-6">
              {memoryNote}
            </p>
            {s.memoryOptIn ? (
              <div className="grid gap-3">
                <h3 className="m-0 text-base">{SETTINGS.memory.remembers}</h3>
                {facts.length ? (
                  <ul className="m-0 grid gap-1 pl-5">
                    {facts.map((f) => (
                      <li key={f}>{f}</li>
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

          {status === "ready" && !isAnonymous ? (
            <Group legend={SETTINGS.account.legend}>
              <p className="m-0">{SETTINGS.account.body}</p>
              <div>
                <Button kind="secondary" onClick={() => void signOut()}>
                  {SETTINGS.account.signOut}
                </Button>
              </div>
              <p role="status" className="note m-0 min-h-6">
                {accountNote}
              </p>
            </Group>
          ) : null}

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
            onClick={() => void forget()}
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
          <Button kind="danger" onClick={() => void erase()}>
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
