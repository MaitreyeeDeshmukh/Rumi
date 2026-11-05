import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FOOTER_NAV, MAIN_NAV, ROUTES } from "@/lib/site";

const appDir = resolve(__dirname, "../../src/app");

function pageFileFor(route: string): string {
  return resolve(appDir, route === "/" ? "page.tsx" : `${route.slice(1)}/page.tsx`);
}

describe("site navigation", () => {
  it("every declared route has a page file", () => {
    for (const route of ROUTES) expect(existsSync(pageFileFor(route)), route).toBe(true);
  });

  it("every internal nav link points to a declared route", () => {
    for (const link of [...MAIN_NAV, ...FOOTER_NAV]) {
      if (link.href.startsWith("/preview")) continue;
      expect(ROUTES, link.href).toContain(link.href);
    }
  });

  it("has custom not-found and error pages", () => {
    for (const f of ["not-found.tsx", "error.tsx", "global-error.tsx"]) {
      expect(existsSync(resolve(appDir, f)), f).toBe(true);
    }
  });
});
