"use client";

import { useEffect, useRef } from "react";
import { useRumi } from "@/features/shims/useRumi.shim";
import { applyTheme } from "@/lib/theme";

/**
 * Applies theme, text size and reduced motion when settings change (Settings, Welcome, the Look switcher).
 * The first run does nothing: the first-paint script already applied what was stored, or the system look.
 * Imports the shim directly; rumiActive.ts cannot be imported here because it re-exports this file.
 */
export function ThemeSync(): null {
  const { state } = useRumi();
  const { theme, textScale, reducedMotion } = state.settings;
  const seen = useRef(null as { theme: string; textScale: number; reducedMotion: boolean } | null);

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
