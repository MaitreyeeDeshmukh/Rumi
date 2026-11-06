import { describe, expect, it } from "vitest";
import { THEMES, THEME_INIT_SCRIPT } from "@/lib/theme";

describe("themes", () => {
  it("lists the three themes with their labels", () => {
    expect(THEMES.map((t) => t.label)).toEqual(["Soft Focus", "High Contrast", "Low Light"]);
    expect(THEMES.map((t) => t.id)).toEqual(["soft", "contrast", "low"]);
  });

  it("first-paint script reads only the shared key", () => {
    for (const needle of ["rumi.v1", "data-app-theme", "prefers-color-scheme", "data-reduced-motion"]) {
      expect(THEME_INIT_SCRIPT).toContain(needle);
    }
    expect(THEME_INIT_SCRIPT).not.toContain("rumi.theme");
    expect(THEME_INIT_SCRIPT).not.toContain("innerHTML");
  });

  it("first-paint script runs and sets the theme", () => {
    const attrs: Record<string, string> = {};
    const style: Record<string, string> = {};
    const root = {
      setAttribute: (k: string, v: string) => {
        attrs[k] = v;
      },
      style: {
        setProperty: (k: string, v: string) => {
          style[k] = v;
        },
      },
    };
    const store = JSON.stringify({ version: 1, settings: { theme: "contrast", textScale: 1.3, reducedMotion: true } });
    new Function("document", "localStorage", "matchMedia", THEME_INIT_SCRIPT)(
      { documentElement: root },
      { getItem: () => store },
      () => ({ matches: false }),
    );
    expect(attrs["data-app-theme"]).toBe("contrast");
    expect(attrs["data-reduced-motion"]).toBe("true");
    expect(style["--scale"]).toBe("1.3");
  });

  it("first-paint script falls back to the OS colour scheme and survives blocked storage", () => {
    const attrs: Record<string, string> = {};
    const root = { setAttribute: (k: string, v: string) => (attrs[k] = v), style: { setProperty: () => {} } };
    const dark = (q: string) => ({ matches: q.includes("prefers-color-scheme: dark") });
    new Function("document", "localStorage", "matchMedia", THEME_INIT_SCRIPT)(
      { documentElement: root },
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      dark,
    );
    expect(attrs["data-app-theme"]).toBe("low");
  });
});
