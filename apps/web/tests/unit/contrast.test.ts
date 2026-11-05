import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex: string): number => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
const themes = new Map<string, Record<string, string>>();
for (const m of css.matchAll(/\[data-app-theme="(\w+)"\]\{([^}]*)\}/g)) {
  const tokens: Record<string, string> = {};
  for (const t of m[2].matchAll(/--([\w-]+):(#[0-9A-Fa-f]{6})/g)) tokens[t[1]] = t[2];
  themes.set(m[1], tokens); // `:root, [data-app-theme="soft"]` is captured as soft
}

const PAIRS: readonly [string, string, number][] = [
  ["ink", "bg", 4.5], ["ink", "surface", 4.5], ["muted", "bg", 4.5], ["muted", "surface", 4.5],
  ["primary-ink", "primary", 4.5], ["primary", "bg", 4.5],
  ["success", "surface", 4.5], ["danger", "surface", 4.5], ["warn", "surface", 4.5],
  ["focus", "bg", 3], ["line-strong", "bg", 3],
  // Text that sits on tinted backgrounds in the UI.
  ["ink", "apricot", 4.5], ["ink", "lav", 4.5], ["ink", "primary-soft", 4.5], ["muted", "primary-soft", 4.5], ["primary", "primary-soft", 4.5],
];

describe("theme contrast (WCAG 2.1 AA)", () => {
  it("finds all three themes", () => {
    expect([...themes.keys()].sort()).toEqual(["contrast", "low", "soft"]);
  });
  for (const [name] of [["soft"], ["contrast"], ["low"]]) {
    for (const [fg, bg, floor] of PAIRS) {
      it(`${name}: ${fg} on ${bg} >= ${floor}`, () => {
        const t = themes.get(name)!;
        expect(t[fg], `${name} --${fg}`).toBeDefined();
        expect(t[bg], `${name} --${bg}`).toBeDefined();
        expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(floor);
      });
    }
  }
});
