import { describe, expect, it, vi } from "vitest";
import { afterAccountDeleted, EMAIL_SENT_KEY, LAST_USER_KEY, type AfterDeleteDeps } from "@/features/auth/afterAccountDeleted";

const deps = (over: Partial<{ removeItem: (k: string) => void; signOut: () => Promise<unknown> }> = {}) => {
  const removed: string[] = [];
  const signOut = vi.fn(over.signOut ?? (() => Promise.resolve({ error: null })));
  const d = { storage: { removeItem: over.removeItem ?? ((k: string) => void removed.push(k)) }, auth: { signOut } } as unknown as AfterDeleteDeps;
  return { d, removed, signOut };
};

describe("afterAccountDeleted", () => {
  it("clears the remembered user id and the email cooldown, and drops the local session only", async () => {
    const { d, removed, signOut } = deps();
    await afterAccountDeleted(d);
    expect(removed.sort()).toEqual([EMAIL_SENT_KEY, LAST_USER_KEY].sort());
    expect(LAST_USER_KEY).toBe("rumi.auth.lastUser");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("never throws: a storage that refuses and a sign-out that fails are each survived, and the other step still runs", async () => {
    const a = deps({
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    await expect(afterAccountDeleted(a.d)).resolves.toBeUndefined();
    expect(a.signOut).toHaveBeenCalledTimes(1);
    const b = deps({ signOut: () => Promise.reject(new Error("offline")) });
    await expect(afterAccountDeleted(b.d)).resolves.toBeUndefined();
    expect(b.removed).toHaveLength(2);
  });

  it("works with no storage at all", async () => {
    const signOut = vi.fn(() => Promise.resolve({ error: null }));
    await expect(afterAccountDeleted({ storage: null, auth: { signOut } as unknown as AfterDeleteDeps["auth"] })).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("with no dependencies given and no browser or no Supabase configuration, it returns quietly", async () => {
    await expect(afterAccountDeleted()).resolves.toBeUndefined();
  });
});
