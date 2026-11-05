'use client';
import { useCallback, useState } from 'react';
import type { PersonaFact } from '@/features/shared/types';
import { useRumi } from '@/features/state/RumiProvider';
import type { MemoryActions, Remote } from './actions';

export interface MemoryControls {
  enabled: boolean;
  recoveryCode: string | undefined;
  facts: PersonaFact[];
  busy: boolean;
  status: 'idle' | 'saved' | 'failed';
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  forgetAll: () => Promise<void>;
}

const toStatus = (r: Remote): MemoryControls['status'] => (r === 'failed' ? 'failed' : 'saved');

/** What the Settings screen uses. One action at a time: calls while busy are ignored. */
export function createUseMemoryControls(actions: MemoryActions) {
  return function useMemoryControls(): MemoryControls {
    const { state, update } = useRumi();
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<MemoryControls['status']>('idle');

    const run = useCallback(async (fn: () => Promise<Remote>) => {
      if (busy) return;
      setBusy(true);
      try { setStatus(toStatus(await fn())); } catch { setStatus('failed'); } finally { setBusy(false); }
    }, [busy]);

    return {
      enabled: state.settings.memoryOptIn,
      recoveryCode: state.settings.memoryOptIn ? state.persona.recoveryCode : undefined,
      facts: state.persona.facts,
      busy,
      status,
      enable: () => run(async () => (await actions.enableMemory(state, update)).remote),
      disable: () => run(async () => { await actions.disableMemory(update); return 'off'; }),
      forgetAll: () => run(async () => (await actions.forgetAll(state, update)).remote),
    };
  };
}
