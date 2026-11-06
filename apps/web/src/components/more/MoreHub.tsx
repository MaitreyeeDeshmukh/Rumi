"use client";

import { useState } from "react";
import { ConfirmDelete, LinkCard, PreviewNote, Section } from "@/components/more/parts";
import { Screen } from "@/components/ui/screen";
import { MORE, MORE_SECTIONS } from "@/content/more";
import { moreStore } from "@/features/more/store";

/** /home/more: one card per preview tool, and a way to erase what they saved. */
export function MoreHub() {
  const [erased, setErased] = useState(false);
  return (
    <Screen title={MORE.title} lead={MORE.lead}>
      <PreviewNote />
      <Section title={MORE.sectionsTitle} className="mt-0">
        <div className="grid gap-3">
          {MORE_SECTIONS.map((s) => (
            <LinkCard key={s.href} href={s.href} title={s.title} text={s.text} />
          ))}
        </div>
      </Section>
      <Section title={MORE.eraseTitle}>
        <p className="m-0 text-ink">{MORE.eraseText}</p>
        <div data-needs-js>
          <ConfirmDelete
            key={String(erased)}
            label={MORE.eraseButton}
            confirm={MORE.eraseConfirm}
            cancel={MORE.eraseCancel}
            onConfirm={() => {
              moreStore.erase();
              setErased(true);
            }}
          />
        </div>
        <p role="status" className="m-0 min-h-6 text-ink">
          {erased ? MORE.erased : ""}
        </p>
      </Section>
    </Screen>
  );
}
