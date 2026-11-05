import { describe, expect, it } from "vitest";
import { present } from "./lanes";

/** Tells the person reading the run which lanes' chaos blocks are live; the blocks themselves say what they wait for. */
describe("lane detection", () => {
  it("finds a module that exists and not one that does not", () => {
    expect(present("lib/ai/http")).toBe(true);
    expect(present("lib/ai/this-module-does-not-exist")).toBe(false);
  });

  it("reports which frozen modules are merged yet", () => {
    const frozen = ["lib/ai/harness", "lib/ai/provider", "lib/ai/flags", "lib/ai/limits", "lib/ai/cache", "lib/log", "lib/errors", "lib/telemetry/sinks", "lib/supabase/admin", "lib/auth/requireUser", "features/auth/mapError", "features/memory/supabaseStore"];
    const status = Object.fromEntries(frozen.map((m) => [m, present(m)]));
    console.info(`frozen modules present: ${JSON.stringify(status)}`);
    // On main (RUMI_REQUIRE_LANES=1) every one of them must exist: no chaos block may still be waiting.
    if (process.env.RUMI_REQUIRE_LANES === "1") expect(Object.values(status).every(Boolean)).toBe(true);
  });
});
