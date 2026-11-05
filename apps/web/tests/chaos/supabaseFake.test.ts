import { expect, it } from "vitest";
import { ERR_MESSAGE } from "./fakes";
import { fakeSupabase } from "./supabaseFake";

type Client = { from(t: string): { select(c: string): { eq(c: string, v: string): { maybeSingle(): Promise<{ data: unknown; error: unknown }> } } & Promise<{ data: unknown; error: unknown }> }; rpc(n: string): Promise<{ data: unknown }>; auth: { getUser(): Promise<{ data: { user: unknown }; error: unknown }> } };

it("the fake answers like Supabase in ok mode", async () => {
  const f = fakeSupabase();
  const c = f.client as Client;
  f.flags.ai_enabled = false;
  expect((await c.from("ops_feature_flags").select("key,enabled").eq("key", "ai_enabled").maybeSingle()).data).toEqual({ key: "ai_enabled", enabled: false });
  expect(((await c.from("ops_feature_flags").select("key,enabled")) as { data: unknown[] }).data).toHaveLength(3);
  f.rpc.ops_x = 7;
  expect((await c.rpc("ops_x")).data).toBe(7);
  expect((await c.auth.getUser()).data.user).toMatchObject({ is_anonymous: true });
  f.user = null;
  expect((await c.auth.getUser()).error).toBeTruthy();
  expect(f.calls.length).toBeGreaterThan(3);
});

it("down rejects, error resolves with an error carrying the marker, hang never settles", async () => {
  const f = fakeSupabase("down");
  const c = f.client as Client;
  await expect(c.rpc("x")).rejects.toThrow(ERR_MESSAGE);
  f.mode = "error";
  expect(JSON.stringify(await c.rpc("x"))).toContain(ERR_MESSAGE);
  f.mode = "hang";
  const winner = await Promise.race([c.rpc("x").then(() => "answered"), new Promise((r) => setTimeout(() => r("still waiting"), 50))]);
  expect(winner).toBe("still waiting");
});
