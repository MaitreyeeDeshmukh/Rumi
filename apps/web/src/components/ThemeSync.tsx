'use client';
import { useEffect } from 'react';
import { STORAGE_KEY, useRumi } from './deps';

/** Keeps <html> data attributes in step with Settings. The first paint is set by the inline script in layout.tsx. */
export function ThemeSync() {
  const { state, hydrated } = useRumi();
  const { theme, reducedMotion, textScale } = state.settings;
  useEffect(() => {
    if (!hydrated) return;
    const h = document.documentElement;
    // Until the user saves anything, keep the OS-based theme the first-paint script picked.
    let saved = false;
    try { saved = window.localStorage.getItem(STORAGE_KEY) !== null; } catch { /* storage blocked */ }
    if (saved) h.dataset.appTheme = theme;
    const osReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    h.dataset.reducedMotion = String(reducedMotion || osReduce);
    h.style.setProperty('--scale', String(textScale));
  }, [hydrated, theme, reducedMotion, textScale]);
  return null;
}
