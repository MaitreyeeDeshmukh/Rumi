'use client';

/**
 * What a screen needs for the memory switch: the actions, the switch state and the remembered sentences.
 * It signs in (anonymously, once) only when memory needs the cloud: turning memory on, or memory already on. It also syncs once when sign-in becomes `ready` and memory is on, so a new device pulls what the account holds and a
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
  const { status, ensureSignedIn } = useAuth();
  // Sign-in happens here, when memory needs the cloud, and not when a page loads.
  const [actions] = useState(() =>
    createMemoryActions({
      store,
      fetchFn: (input, init) => fetch(input, init),
      ensureSignedIn: async () => (await ensureSignedIn()).status,
    }),
  );
  // Tell the actions about sign-in before the sync effect below runs (effects run in order).
  useEffect(() => actions.setAuthStatus(status), [actions, status]);

  const enabled = state.settings.memoryOptIn;
  useEffect(() => {
    if (hydrated && enabled && status === 'ready') void actions.syncPersona();
  }, [actions, hydrated, enabled, status]);
  // Memory is on but this browser has no session (cookies cleared): sign in again so the sync above can run.
  useEffect(() => {
    if (hydrated && enabled && status === 'signed_out') void ensureSignedIn();
  }, [ensureSignedIn, hydrated, enabled, status]);

  return { actions, enabled, facts: factStrings(state.persona.facts) };
}
