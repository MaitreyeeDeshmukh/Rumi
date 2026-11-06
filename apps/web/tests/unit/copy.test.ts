import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "@/lib/banned";
import { literalLint } from "@/lib/literalLint";

/**
 * Strings the 15-word and idiom rules do not apply to. Key is "file:key.path"; value is the one-line reason.
 * Allowed reasons: crisis text, legal fine print, vendor names.
 */
export const LINT_EXEMPT: Record<string, string> = {
  "content/crisis.ts:CRISIS.text": "Crisis text from the team contract; its first sentence is longer than 15 words on purpose.",
};

const srcPath = (rel: string): string => join(fileURLToPath(new URL("../../src/", import.meta.url)), rel);

function contentFiles(): string[] {
  const dir = srcPath("content");
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts")) : [];
  return [...names.map((n) => `content/${n}`), "components/copy.ts"];
}

function flatten(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, path ? `${path}.${k}` : k, out);
  }
}

describe("copy gate", () => {
  it("every user-facing string passes literalLint and the banned words", async () => {
    const problems: string[] = [];
    const linted: string[] = [];
    for (const file of contentFiles()) {
      const mod = (await import(/* @vite-ignore */ `@/${file.replace(/\.ts$/, "")}`)) as Record<string, unknown>;
      const strings: [string, string][] = [];
      for (const [name, exported] of Object.entries(mod)) flatten(exported, name, strings);
      linted.push(file);
      // A content file with no strings is a mistake; COPY may be empty until screens fill it.
      if (file !== "components/copy.ts") expect(strings.length, `${file} has no strings`).toBeGreaterThan(0);
      for (const [key, text] of strings) {
        const id = `${file}:${key}`;
        if (id in LINT_EXEMPT) continue;
        const maxWords = file === "content/pages.ts" && key.endsWith(".description") ? 30 : 15;
        const { failures } = literalLint(text, { maxWords });
        for (const f of failures) problems.push(`${id}: ${f.reason}: ${f.sentence}`);
        if (BANNED_WORDS.test(text)) problems.push(`${id}: banned word in "${text}"`);
      }
    }
    expect(problems).toEqual([]);
    expect(linted).toEqual(contentFiles());
  });

  it("COPY exists and is a plain object", async () => {
    const mod = await import("@/components/copy");
    expect(typeof mod.COPY).toBe("object");
    expect(mod.COPY).not.toBeNull();
    expect(contentFiles()).toContain("components/copy.ts");
  });

  it("the flattener reaches nested strings and the lint catches them", () => {
    const out: [string, string][] = [];
    flatten({ a: { b: ["One!", "Two."] }, c: 3 }, "T", out);
    expect(out).toEqual([
      ["T.a.b[0]", "One!"],
      ["T.a.b[1]", "Two."],
    ]);
    expect(literalLint("Please take the pill and then call me before you go to bed tonight at home.").ok).toBe(false);
  });

  it("every exempt key has a reason", () => {
    for (const [key, reason] of Object.entries(LINT_EXEMPT)) expect(reason.length, key).toBeGreaterThan(5);
  });
});
