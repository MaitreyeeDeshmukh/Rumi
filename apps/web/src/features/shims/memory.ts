// swap when the lane merges (src/features/memory/useMemoryControls.ts). Local only: nothing is sent anywhere yet.
import type { RumiState } from "@/features/shims/types";

type Update = (fn: (draft: RumiState) => void) => void;

/** Forgets every remembered sentence and turns memory off. */
export const forgetMemory = (update: Update): void =>
  update((d) => {
    d.persona = { facts: [] };
    d.settings.memoryOptIn = false;
  });
