import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
export const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
const themes: Record<string, Record<string, string>> = {};
for (const m of css.matchAll(/\[data-app-theme="(\w+)"\]\{([^}]*)\}/g)) {
  const vars: Record<string, string> = {};
  for (const v of m[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) vars[v[1]] = v[2];
  themes[m[1]] = vars;
}

const AT_LEAST_4_5: [string, string][] = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["primary-ink", "primary"],
  ["primary", "bg"],
  ["primary", "surface"],
  ["primary", "primary-soft"],
  ["ink", "lav"],
  ["ink", "primary-soft"],
  ["success", "surface"],
  ["danger", "surface"],
  ["danger", "bg"],
  ["warn", "surface"],
  ["danger-ink", "danger"],
];
const AT_LEAST_3: [string, string][] = [
  ["focus", "bg"],
  ["line-strong", "bg"],
  // The mascot's eyes and mouth must be visible on its face in every look (High Contrast had a blank face).
  ["mascot-ink", "lav-strong"],
];

describe("theme contrast", () => {
  it("defines the three themes", () => {
    expect(Object.keys(themes).sort()).toEqual(["contrast", "low", "soft"]);
  });

  for (const name of ["soft", "contrast", "low"]) {
    describe(name, () => {
      for (const [a, b] of AT_LEAST_4_5) {
        it(`${a} on ${b} is at least 4.5`, () => {
          const t = themes[name];
          expect(t?.[a], `--${a}`).toBeTruthy();
          expect(t?.[b], `--${b}`).toBeTruthy();
          expect(ratio(t[a], t[b])).toBeGreaterThanOrEqual(4.5);
        });
      }
      for (const [a, b] of AT_LEAST_3) {
        it(`${a} on ${b} is at least 3`, () => {
          const t = themes[name];
          expect(t?.[a], `--${a}`).toBeTruthy();
          expect(t?.[b], `--${b}`).toBeTruthy();
          expect(ratio(t[a], t[b])).toBeGreaterThanOrEqual(3);
        });
      }
    });
  }
});
