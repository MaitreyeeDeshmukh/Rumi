'use client';
/**
 * TEMPORARY stand-in for Sujal's `useMemoryControls()` (@/features/memory).
 * Local only. It never talks to Supermemory. The recovery code here is only for the UI flow.
 */
import { useState } from 'react';
import { useRumi } from './state';

export function useMemoryControls(): {
  enabled: boolean; code?: string; facts: string[]; status: 'idle' | 'saved' | 'error';
  setEnabled: (on: boolean) => Promise<void>; forgetAll: () => Promise<void>;
} {
  const { state, update } = useRumi();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const setEnabled = async (on: boolean): Promise<void> => {
    update((d) => {
      d.settings.memoryOptIn = on;
      if (on && !d.persona.recoveryCode) {
        const bytes = crypto.getRandomValues(new Uint8Array(9));
        d.persona.recoveryCode = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{1,6}/g)!.join('-');
      }
    });
    setStatus('saved');
  };
  const forgetAll = async (): Promise<void> => {
    update((d) => { d.persona = { facts: [] }; d.settings.memoryOptIn = false; });
    setStatus('saved');
  };
  return { enabled: state.settings.memoryOptIn, code: state.persona.recoveryCode, facts: state.persona.facts.map((f) => f.text), status, setEnabled, forgetAll };
}
