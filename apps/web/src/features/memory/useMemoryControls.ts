'use client';

/**
 * What a screen needs for the memory switch: the actions, the switch state and the remembered sentences.
 * It also syncs once when sign-in becomes `ready` and memory is on, so a new device pulls what the account holds and a
 * device that was offline pushes what it kept. The UI never waits for it. Browser only.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useRumi, useRumiStore } from '@/features/state/RumiProvider';
import { createMemoryActions, type MemoryActions } from './actions';
import { factStrings } from './factText';

export interface MemoryControls {
  actions: MemoryActions;
  enabled: boolean;
  /** The sentences Rumi remembers, in plain words. */
  facts: string[];
}

export function useMemoryControls(): MemoryControls {
  const store = useRumiStore();
  const { state, hydrated } = useRumi();
  const { status } = useAuth();
  const [actions] = useState(() => createMemoryActions({ store, fetchFn: (input, init) => fetch(input, init) }));
  // Tell the actions about sign-in before the sync effect below runs (effects run in order).
  useEffect(() => actions.setAuthStatus(status), [actions, status]);

  const enabled = state.settings.memoryOptIn;
  useEffect(() => {
    if (hydrated && enabled && status === 'ready') void actions.syncPersona();
  }, [actions, hydrated, enabled, status]);

  return { actions, enabled, facts: factStrings(state.persona.facts) };
}
