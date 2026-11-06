import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import * as site from "@/lib/site";
import { FOOTER_COLUMNS, FOOTER_LINKS, INFO_LINKS, MAIN_NAV, ROUTES } from "@/lib/site";

const appDir = resolve(__dirname, "../../src/app");

/** A route's page file lives in src/app, src/app/(site) or src/app/(app). */
function pageFileFor(route: string): string | undefined {
  const rel = route === "/" ? "page.tsx" : `${route.slice(1)}/page.tsx`;
  return ["", "(site)", "(app)"].map((g) => resolve(appDir, g, rel)).find((f) => existsSync(f));
}

describe("site navigation", () => {
  it("every declared route has a page file", () => {
    for (const route of ROUTES) expect(pageFileFor(route), route).toBeDefined();
  });

  it("lists the seventeen routes that exist", () => {
    expect([...ROUTES]).toEqual([
      "/",
      "/how-it-works",
      "/about",
      "/contact",
      "/help",
      "/safety",
      "/privacy",
      "/accessibility",
      "/welcome",
      "/home",
      "/get-ready",
      "/practice",
      "/remember",
      "/share",
      "/kit",
      "/say-it",
      "/settings",
    ]);
  });

  it("every nav, footer and info link points to a declared route", () => {
    for (const link of [...MAIN_NAV, ...FOOTER_LINKS, ...INFO_LINKS]) {
      expect(link.href.startsWith("/preview"), link.href).toBe(false);
      expect(ROUTES, link.href).toContain(link.href);
    }
  });

  it("has the header links, three footer columns and five info links", () => {
    expect(MAIN_NAV.map((l) => l.href)).toEqual(["/how-it-works", "/safety", "/help", "/contact"]);
    expect(FOOTER_COLUMNS.map((c) => c.title)).toEqual(["Rumi", "Trust", "Help"]);
    expect(FOOTER_COLUMNS.map((c) => c.links.map((l) => l.href))).toEqual([
      ["/how-it-works", "/about", "/welcome"],
      ["/safety", "/privacy", "/accessibility"],
      ["/help", "/contact"],
    ]);
    expect(FOOTER_LINKS).toEqual(FOOTER_COLUMNS.flatMap((c) => c.links));
    expect(INFO_LINKS.map((l) => l.href)).toEqual(["/help", "/contact", "/privacy", "/accessibility", "/safety"]);
    expect(INFO_LINKS.at(-1)?.label).toBe("Safety and crisis help");
  });

  it("the old FOOTER_NAV export is gone", () => {
    expect("FOOTER_NAV" in site).toBe(false);
  });

  it("has custom not-found and error pages", () => {
    for (const f of ["not-found.tsx", "error.tsx", "global-error.tsx"]) {
      expect(existsSync(resolve(appDir, f)), f).toBe(true);
    }
  });
});
