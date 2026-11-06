"use client";

import { useState, useSyncExternalStore } from "react";
import { Segmented } from "@/components/ui/segmented";
import { NAV } from "@/content/nav";
import { useRumi } from "@/lib/rumiActive";
import { THEMES, type ThemeName } from "@/lib/theme";

const ATTR = "data-app-theme";

// The first-paint script sets the attribute; watching it keeps the radios right if another part changes it.
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
  return () => observer.disconnect();
}
const current = (): string => document.documentElement.getAttribute(ATTR) ?? THEMES[0].id;

/** Soft Focus, High Contrast, Low Light. Applied at once and saved. Rendered only on the client. */
export function LookSwitcher() {
  const theme = useSyncExternalStore(subscribe, current, () => null);
  const [announcement, setAnnouncement] = useState("");
  const { update } = useRumi();
  if (theme === null) return null;

  const choose = (value: string) => {
    const next = THEMES.find((t) => t.id === value);
    if (!next) return;
    update((draft) => {
      draft.settings.theme = next.id as ThemeName;
    });
    setAnnouncement(`${NAV.lookChanged} ${next.label}.`);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span aria-hidden="true" className="font-bold text-ink">
        {NAV.look}
      </span>
      <Segmented
        label={NAV.look}
        value={theme}
        onValueChange={choose}
        options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
