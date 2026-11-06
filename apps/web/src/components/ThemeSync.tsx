"use client";

import { useEffect, useRef } from "react";
import { useRumi } from "@/features/state/RumiProvider";
import type { ThemeName } from "@/features/shared/types";
import { inspectStorage } from "@/lib/storage";
import { THEMES, applyTheme } from "@/lib/theme";

const SCALES = [1, 1.15, 1.3, 1.5] as const;

/** The look the first-paint script already put on the page (the saved one, or the system's dark mode and reduced motion). */
function appliedLook(): { theme: ThemeName; textScale: (typeof SCALES)[number]; reducedMotion: boolean } | null {
  const root = document.documentElement;
  const theme = THEMES.find((t) => t.id === root.getAttribute("data-app-theme"))?.id;
  const scale = Number(root.style.getPropertyValue("--scale"));
  const textScale = SCALES.find((s) => s === scale);
  return theme && textScale ? { theme, textScale, reducedMotion: root.getAttribute("data-reduced-motion") === "true" } : null;
}

/**
 * Applies theme, text size and reduced motion when settings change (Settings, Welcome, the Look switcher).
 * The first run does nothing: the first-paint script already applied what was stored, or the system look.
 * A new visitor whose system look differs from the defaults has that look saved as their setting, so the controls
 * show what they see and the first change they make does not flip the page to the default look.
 */
export function ThemeSync(): null {
  const { state, update, hydrated } = useRumi();
  const { theme, textScale, reducedMotion } = state.settings;
  const seen = useRef(null as { theme: string; textScale: number; reducedMotion: boolean } | null);
  const seeded = useRef(false);

  useEffect(() => {
    if (!hydrated || seeded.current) return;
    seeded.current = true;
    if (inspectStorage().status !== "missing") return;
    const look = appliedLook();
    if (look && (look.theme !== theme || look.textScale !== textScale || look.reducedMotion !== reducedMotion)) {
      update((d) => void Object.assign(d.settings, look));
    }
  }, [hydrated, theme, textScale, reducedMotion, update]);

  useEffect(() => {
    const before = seen.current;
    seen.current = { theme, textScale, reducedMotion };
    if (!before) return;
    const root = document.documentElement;
    if (before.theme !== theme) applyTheme(theme, root);
    if (before.textScale !== textScale) root.style.setProperty("--scale", String(textScale));
    if (before.reducedMotion !== reducedMotion) root.setAttribute("data-reduced-motion", String(reducedMotion));
  }, [theme, textScale, reducedMotion]);

  return null;
}
