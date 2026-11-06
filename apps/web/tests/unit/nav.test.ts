import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PARENT, backAriaLabel, backHref, isAppRoute, navStack, navStore } from "@/lib/nav";

const WITH_PARENT = Object.entries(PARENT).filter(([, p]) => p !== null);

describe("backHref", () => {
  it("falls back to the fixed parent for all 20 routes that have one", () => {
    expect(WITH_PARENT).toHaveLength(20);
    for (const [route, parent] of WITH_PARENT) expect(backHref(route, []), route).toBe(parent);
  });
  it("has the exact parent table", () => {
    for (const r of ["/how-it-works", "/about", "/contact", "/help", "/safety", "/privacy", "/accessibility", "/welcome", "/home"])
      expect(PARENT[r]).toBe("/");
    for (const r of ["/get-ready", "/practice", "/remember", "/share", "/kit", "/say-it", "/settings"])
      expect(PARENT[r]).toBe("/home");
    for (const r of ["/appointments", "/record"]) expect(PARENT[r]).toBe("/home");
    for (const r of ["/appointments/new", "/appointment"]) expect(PARENT[r]).toBe("/appointments");
    expect(PARENT["/"]).toBeNull();
  });
  it("is null only for the home page", () => {
    expect(backHref("/", ["/"])).toBeNull();
    expect(backHref("/", [])).toBeNull();
  });
  it("sends unknown paths to /", () => {
    expect(backHref("/nope", [])).toBe("/");
  });
  it("uses the entry below the top when the stack has one", () => {
    expect(backHref("/help", ["/contact", "/help"])).toBe("/contact");
  });
  it("ignores a stack whose top is not the current path, or a below entry equal to it", () => {
    expect(backHref("/help", ["/contact", "/about"])).toBe("/");
    expect(backHref("/help", ["/help", "/help"])).toBe("/");
  });
});

describe("navStack", () => {
  it("appends, ignores repeats and pops on going back", () => {
    expect(navStack([], "/a")).toEqual(["/a"]);
    expect(navStack(["/a"], "/b")).toEqual(["/a", "/b"]);
    expect(navStack(["/a", "/b"], "/a")).toEqual(["/a"]);
    expect(navStack(["/a", "/b"], "/b")).toEqual(["/a", "/b"]);
    expect(navStack(["/a", "/b", "/c"], "/b")).toEqual(["/a", "/b"]);
  });
  it("does not mutate its input", () => {
    const s = ["/a", "/b"];
    navStack(s, "/a");
    expect(s).toEqual(["/a", "/b"]);
  });
  it("walks the contact, help, contact sequence", () => {
    let stack = navStack([], "/contact");
    expect(stack).toEqual(["/contact"]);
    stack = navStack(stack, "/help");
    expect(stack).toEqual(["/contact", "/help"]);
    expect(backHref("/help", stack)).toBe("/contact");
    stack = navStack(stack, "/contact");
    expect(stack).toEqual(["/contact"]);
    expect(backHref("/contact", stack)).toBe("/");
  });
});

describe("backAriaLabel", () => {
  it("names the destination when its title is known", () => {
    expect(backAriaLabel("/share", (h) => ({ "/share": "Share" } as Record<string, string>)[h])).toBe("Back to Share");
  });
  it("is just Back when the title is unknown", () => {
    expect(backAriaLabel("/share", () => undefined)).toBe("Back");
  });
});

describe("isAppRoute", () => {
  it("is true for the thirteen app routes only", () => {
    for (const r of ["/home", "/welcome", "/get-ready", "/practice", "/remember", "/share", "/kit", "/say-it", "/settings", "/appointments", "/appointments/new", "/appointment", "/record"])
      expect(isAppRoute(r), r).toBe(true);
    for (const r of ["/", "/help", "/contact", "/nope"]) expect(isAppRoute(r), r).toBe(false);
  });
});

describe("navStore", () => {
  it("records through navStack and counts navigations after the first page", () => {
    const first = navStore.getSnapshot();
    expect(first.count).toBe(0);
    navStore.record("/contact");
    expect(navStore.getSnapshot().stack).toEqual(["/contact"]);
    expect(navStore.getSnapshot().count).toBe(0);
    let calls = 0;
    const off = navStore.subscribe(() => calls++);
    navStore.record("/contact");
    expect(calls).toBe(0);
    navStore.record("/help");
    expect(calls).toBe(1);
    expect(navStore.getSnapshot()).toEqual({ stack: ["/contact", "/help"], count: 1 });
    off();
  });
});

describe("nav.ts stays pure", () => {
  it("has no icon, framework or pages import", () => {
    const text = readFileSync(new URL("../../src/lib/nav.ts", import.meta.url), "utf8");
    expect(text).not.toMatch(/lucide/i);
    expect(text).not.toMatch(/react/i);
    expect(text).not.toMatch(/PAGES/);
  });
});
