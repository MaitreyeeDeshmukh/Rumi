import { describe, expect, it } from "vitest";
import { newRequestId, requestIdOf } from "@/lib/requestContext";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const withId = (id: string): Request => new Request("https://rumi.test/api/x", { headers: { "x-request-id": id } });

describe("requestIdOf", () => {
  it("keeps an id shaped like a uuid, in either case", () => {
    const id = "3f2b8c1e-5d4a-4b7e-9a10-2c3d4e5f6a7b";
    expect(requestIdOf(withId(id))).toBe(id);
    expect(requestIdOf(withId(id.toUpperCase()))).toBe(id.toUpperCase());
  });

  it("replaces anything else with a fresh uuid, so a forged header never reaches a log or a response", () => {
    for (const bad of ["req-1", "x".repeat(36), "a".repeat(37), "a".repeat(35), "3f2b8c1e 5d4a 4b7e 9a10 2c3d4e5f6a7b", "<script>alert(1)</script>".padEnd(36, "a"), "3f2b8c1e-5d4a-4b7e-9a10-2c3d4e5f6a7g", ""]) {
      const got = requestIdOf(withId(bad));
      expect({ bad, ok: UUID.test(got) && got !== bad }).toEqual({ bad, ok: true });
    }
  });

  it("makes a fresh id when none was sent, different every time", () => {
    const r = new Request("https://rumi.test/api/x");
    expect(requestIdOf(r)).toMatch(UUID);
    expect(requestIdOf(r)).not.toBe(requestIdOf(r));
    expect(newRequestId()).toMatch(UUID);
  });
});
