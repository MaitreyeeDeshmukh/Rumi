import { describe, expect, it } from "vitest";
import { shouldStick } from "@/lib/sticky";

const base = { width: 375, innerHeight: 700, visualViewportHeight: 700, stickyHeight: 80, isApp: true };

describe("shouldStick", () => {
  it("sticks on an app phone screen", () => {
    expect(shouldStick(base)).toBe(true);
  });
  it("does not stick outside the app", () => {
    expect(shouldStick({ ...base, isApp: false })).toBe(false);
  });
  it("does not stick at 1024 px and up", () => {
    expect(shouldStick({ ...base, width: 1024 })).toBe(false);
    expect(shouldStick({ ...base, width: 1023 })).toBe(true);
  });
  it("does not stick when the keyboard is open", () => {
    expect(shouldStick({ ...base, visualViewportHeight: 400 })).toBe(false);
  });
  it("sticks at the 0.75 keyboard boundary", () => {
    expect(shouldStick({ ...base, visualViewportHeight: 525 })).toBe(true);
    expect(shouldStick({ ...base, visualViewportHeight: 524 })).toBe(false);
  });
  it("does not stick when it would cover more than a third of the screen", () => {
    expect(shouldStick({ ...base, stickyHeight: 300 })).toBe(false);
    expect(shouldStick({ ...base, stickyHeight: 700 / 3 })).toBe(true);
  });
});
