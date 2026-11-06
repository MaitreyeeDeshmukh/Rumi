"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { COPY } from "@/components/copy";
import { Button, ButtonLink } from "@/components/ui/button";
import { ChoiceCard, ChoiceGroup } from "@/components/ui/choice-card";
import { Field, fieldControlClass } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { ThemeSwatch } from "@/components/ui/theme-swatch";
import { StickyActions } from "@/components/ui/sticky-actions";
import { WELCOME } from "@/content/welcome";
import type { RumiState, Settings, ThemeName } from "@/features/shared/types";
import { PAGES } from "@/lib/pages";
import { useRumi } from "@/lib/rumiActive";
import { THEMES } from "@/lib/theme";

const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

function WelcomeBody({ settings, hydrated }: { settings: Settings; hydrated: boolean }) {
  const { update } = useRumi();
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(settings.name);
  const [helper, setHelper] = useState(settings.companionName);
  const [output, setOutput] = useState(settings.outputMode);
  const [detail, setDetail] = useState(settings.detail);
  const page = PAGES["/welcome"];

  // Start and Skip for now save the same things: setup is done, plus every field that has text or a choice.
  const save = () =>
    update((draft: RumiState) => {
      draft.settings.onboarded = true;
      if (name.trim()) draft.settings.name = name.trim();
      if (helper.trim()) draft.settings.companionName = helper.trim();
      draft.settings.outputMode = output;
      draft.settings.detail = detail;
    });

  const start = (e: FormEvent) => {
    e.preventDefault();
    save();
    router.push("/home");
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4">
        <h1 tabIndex={-1}>{page.h1}</h1>
        <div data-needs-js>
          <ButtonLink kind="tertiary" href="/home" onClick={save}>
            {WELCOME.skip}
          </ButtonLink>
        </div>
      </div>
      <p className="intro">{page.lead}</p>

      <form data-needs-js onSubmit={start}>
        {/* Until the saved state has loaded the fields are off, so nothing typed can be lost when they restart. */}
        <fieldset disabled={!hydrated} className="m-0 grid min-w-0 gap-6 border-0 p-0">
          <Field id={`${id}-name`} label={WELCOME.nameLabel}>
            <input
              name="name"
              type="text"
              autoComplete="given-name"
              maxLength={40}
              className={fieldControlClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field id={`${id}-helper`} label={WELCOME.helperLabel}>
            <input
              name="companionName"
              type="text"
              maxLength={30}
              className={fieldControlClass}
              value={helper}
              onChange={(e) => setHelper(e.target.value)}
            />
          </Field>

          <fieldset className="m-0 grid gap-3 border-0 p-0">
            <legend className="mb-1 p-0 font-bold text-ink">{WELCOME.infoLegend}</legend>
            <Segmented
              showLabel
              label={WELCOME.outputLabel}
              value={output}
              onValueChange={(v) => setOutput(v as Settings["outputMode"])}
              options={options(WELCOME.output)}
            />
            <Segmented
              showLabel
              label={WELCOME.detailLabel}
              value={detail}
              onValueChange={(v) => setDetail(v as Settings["detail"])}
              options={options(WELCOME.detail)}
            />
          </fieldset>

          <fieldset className="m-0 grid gap-3 border-0 p-0">
            <legend className="mb-1 p-0 font-bold text-ink">{WELCOME.lookLegend}</legend>
            <ChoiceGroup
              aria-label={WELCOME.lookLegend}
              value={hydrated ? settings.theme : ""}
              onValueChange={(v) =>
                update((draft: RumiState) => {
                  draft.settings.theme = v as ThemeName;
                })
              }
            >
              {THEMES.map((t) => (
                <ChoiceCard key={t.id} value={t.id} title={t.label}>
                  <ThemeSwatch theme={t.id} />
                  <span className="block">{WELCOME.lookHint[t.id]}</span>
                </ChoiceCard>
              ))}
            </ChoiceGroup>
          </fieldset>

          <StickyActions>
            <Button kind="primary" type="submit" arrow block>
              {WELCOME.start}
            </Button>
          </StickyActions>
        </fieldset>
      </form>

      <p className="note mt-6 mb-1">{WELCOME.later}</p>
      <p className="note m-0">{COPY.notDoctor}</p>
    </>
  );
}

/** /welcome: four optional questions. The body restarts once the saved state has loaded, so the fields show it. */
export function WelcomeScreen() {
  const { state, hydrated } = useRumi();
  return (
    <div className="page-enter">
      <WelcomeBody key={hydrated ? "loaded" : "loading"} settings={state.settings} hydrated={hydrated} />
    </div>
  );
}
