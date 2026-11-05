// stub for lane merge: owned by prod-persona. Delete this file at merge; the real module (MemoryStore over persona_facts) replaces it.
// Contract the harness relies on: never throws, gives up after 1500 ms, returns [] on any failure.
export async function getMemoryFacts(): Promise<string[]> {
  return [];
}
