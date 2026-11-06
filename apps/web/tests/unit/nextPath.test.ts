import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/features/auth/nextPath";

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/privacy", "/privacy"],
    ["/plan/abc?x=1#top", "/plan/abc?x=1#top"],
    ["/a//b", "/a//b"],
    ["/see?next=https://other.test", "/see?next=https://other.test"],
  ])("keeps the same-site path %s", (input, out) => {
    expect(safeNextPath(input)).toBe(out);
  });

  it.each([
    ["//evil.test"],
    ["///evil.test"],
    ["/\\evil.test"],
    ["\\evil.test"],
    ["https://evil.test"],
    ["http://evil.test/x"],
    ["javascript:alert(1)"],
    ["data:text/html,hi"],
    ["evil.test"],
    ["privacy"],
    [""],
    ["/ok\nLocation: x"],
    ["/ok\r"],
    ["/a b"],
    ["/\ttab"],
    ["/login"],
    ["/login?next=/"],
    ["/signup/"],
    ["/" + "a".repeat(600)],
  ])("falls back to / for %j", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("falls back to / when there is no value, and uses the first value of a repeated one", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(["/help", "//evil.test"])).toBe("/help");
    expect(safeNextPath(["//evil.test", "/help"])).toBe("/");
    expect(safeNextPath([])).toBe("/");
  });

  it("never returns anything but a path that starts with one slash", () => {
    for (const input of ["/%2f%2fevil.test", "/.//evil.test", "/..//evil.test", "/x/../../evil.test"]) {
      const out = safeNextPath(input);
      expect(out.startsWith("/") && !out.startsWith("//"), `${input} -> ${out}`).toBe(true);
    }
  });
});
