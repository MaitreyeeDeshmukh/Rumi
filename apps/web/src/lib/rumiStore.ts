// Shim of the state lane's storage (same key and shape as 00-shared-contract.md section 4).
// Only the useRumi shim calls the read and write functions; the lane replaces them.

export const STORAGE_KEY = "rumi.v1";

export const DEFAULT_SETTINGS = {
  name: "",
  companionName: "Rumi",
  theme: "soft",
  textScale: 1,
  reducedMotion: false,
  outputMode: "both",
  detail: "short",
  speechRate: 1,
  finishSound: false,
  memoryOptIn: false,
  onboarded: false,
};

export const defaultState = () => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, sessions: [], persona: { facts: [] } });

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The whole stored object of a version 1 store; null for missing, junk, another version, or blocked storage. */
export function readState(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    return isRecord(data) && data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

/** True when the store holds data of another `version`: it is read as empty and never overwritten. */
export function foreignVersion(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): boolean {
  try {
    const data: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    return isRecord(data) && data.version !== 1;
  } catch {
    return false;
  }
}

/** Writes the whole state. Refuses (false) when blocked, or when the store holds another `version`. */
export function writeState(
  state: Record<string, unknown>,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    const raw = storage.getItem(STORAGE_KEY);
    if (raw != null) {
      let existing: unknown = null;
      try {
        existing = JSON.parse(raw);
      } catch {
        // junk: nothing worth keeping
      }
      if (isRecord(existing) && existing.version !== 1) return false;
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Removes the stored state (Delete everything). */
export function clearState(storage: Pick<Storage, "removeItem"> | undefined = browserStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // blocked: nothing was stored
  }
}

/** True when the browser lets this page read its storage. Used to warn that work will not be saved. */
export function storageWorks(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): boolean {
  try {
    storage?.getItem(STORAGE_KEY);
    return storage !== undefined;
  } catch {
    return false;
  }
}
