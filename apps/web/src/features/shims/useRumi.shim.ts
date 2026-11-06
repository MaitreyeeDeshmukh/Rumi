"use client";

// swap when the lane merges (src/features/state/useRumi.ts). Same signature: { state, update, reset, hydrated },
// plus `persisted` (false when the last write failed). One module store over localStorage["rumi.v1"]. React reads it
// with useSyncExternalStore, so there is no setState in an effect. While storage is blocked the state still lives
// in memory, so every control keeps working.
import { useSyncExternalStore } from "react";
import { FOCUS_LABELS } from "@/content/dashboard";
import type { RumiState } from "@/features/shims/types";
import { useIsClient } from "@/hooks/useIsClient";
import {
  DEFAULT_SETTINGS,
  clearState,
  defaultState,
  foreignVersion,
  isRecord,
  readState,
  writeState,
} from "@/lib/rumiStore";
import { THEMES } from "@/lib/theme";

const SCALES = [1, 1.15, 1.3, 1.5];
const bool = (v: unknown): boolean => typeof v === "boolean";
const text = (v: unknown): boolean => typeof v === "string";

/** What the first-paint script already applied, so a person who never chose a look keeps the one their system gave. */
type Look = { theme: string; textScale: number; reducedMotion: boolean };
function appliedLook(): Look {
  const root = document.documentElement;
  const theme = root.getAttribute("data-app-theme");
  const scale = Number(root.style.getPropertyValue("--scale"));
  return {
    theme: THEMES.some((t) => t.id === theme) ? (theme as string) : DEFAULT_SETTINGS.theme,
    textScale: SCALES.includes(scale) ? scale : 1,
    reducedMotion: root.getAttribute("data-reduced-motion") === "true",
  };
}

// Which values each setting may hold. Anything else falls back to the applied look or the default.
const VALID: Record<keyof typeof DEFAULT_SETTINGS, (v: unknown) => boolean> = {
  name: text,
  companionName: text,
  theme: (v) => THEMES.some((t) => t.id === v),
  textScale: (v) => SCALES.includes(v as number),
  reducedMotion: bool,
  outputMode: (v) => v === "read" || v === "listen" || v === "both",
  detail: (v) => v === "short" || v === "detailed",
  speechRate: (v) => typeof v === "number" && Number.isFinite(v),
  finishSound: bool,
  memoryOptIn: bool,
  onboarded: bool,
};

const isPlan = (v: unknown): boolean => isRecord(v) && Array.isArray(v.items) && typeof v.mainConcern === "string";

/** A session with defaults for missing parts, like the state lane's loader. Not a record: dropped (null). */
function repairSession(v: unknown): Record<string, unknown> | null {
  if (!isRecord(v)) return null;
  const used = isRecord(v.helpLevelUsed) ? v.helpLevelUsed : {};
  return {
    ...v,
    focus: typeof v.focus === "string" && v.focus in FOCUS_LABELS ? v.focus : "whole",
    coveredItemIds: Array.isArray(v.coveredItemIds) ? v.coveredItemIds.filter((id) => typeof id === "string") : [],
    helpCount: typeof v.helpCount === "number" && Number.isFinite(v.helpCount) ? v.helpCount : 0,
    helpLevelUsed: Object.fromEntries(Object.entries(used).filter(([, l]) => [0, 1, 2, 3].includes(l as number))),
  };
}

/**
 * A usable state from whatever was stored. Junk parts fall back to the defaults.
 * `look` is the look the first-paint script applied. It is merged into the settings, so the first write
 * (Start, Skip, a Look choice) stores it: the system's dark mode or reduced motion is then kept as the person's choice.
 */
function normalize(raw: Record<string, unknown> | null, look?: Look): RumiState {
  const stored = raw && isRecord(raw.settings) ? raw.settings : {};
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...look, ...stored };
  for (const key of Object.keys(VALID) as (keyof typeof VALID)[]) {
    if (!VALID[key](settings[key])) settings[key] = look?.[key as keyof Look] ?? DEFAULT_SETTINGS[key];
  }
  const sessions = raw?.sessions;
  const state: Record<string, unknown> = {
    ...(raw ?? defaultState()),
    version: 1,
    settings,
    sessions: Array.isArray(sessions) ? sessions.map(repairSession).filter((s) => s !== null) : [],
    persona: raw && isRecord(raw.persona) ? raw.persona : { facts: [] },
  };
  if (!isPlan(state.plan)) delete state.plan;
  if (!isRecord(state.supportCard)) delete state.supportCard;
  if (!isRecord(state.recap)) delete state.recap;
  return state as unknown as RumiState;
}

const SERVER_STATE = normalize(null);
let current: RumiState | null = null;
let persisted = true;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function load(): RumiState {
  persisted = !foreignVersion();
  return normalize(readState(), appliedLook());
}

const getSnapshot = (): RumiState => (current ??= load());
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Another tab wrote the store: read it again. */
export function refreshFromStorage(): void {
  current = null;
  notify();
}

export function update(fn: (draft: RumiState) => void): void {
  const draft = structuredClone(getSnapshot());
  fn(draft);
  current = draft;
  persisted = writeState(draft as unknown as Record<string, unknown>);
  notify();
}

export function reset(): void {
  clearState();
  persisted = true;
  current = normalize(null, appliedLook());
  notify();
}

export function useRumi(): {
  state: RumiState;
  update: typeof update;
  reset: typeof reset;
  hydrated: boolean;
  /** False when the last write did not reach storage: the person's work will be lost when the page closes. */
  persisted: boolean;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
  const saved = useSyncExternalStore(subscribe, () => persisted, () => true);
  return { state, update, reset, hydrated: useIsClient(), persisted: saved };
}
