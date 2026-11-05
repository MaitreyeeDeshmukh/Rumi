// stub for lane merge: owned by prod-ai-runtime (frozen signature, addendum section 3). Delete this file at merge.
export type FlagKey = 'ai_enabled' | 'memory_sync_enabled' | 'cloud_sync_enabled';

export async function getFlag(_key: FlagKey): Promise<boolean> {
  return true;
}
