import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/**
 * Old files that still break a rule. This list may not grow. Task 8 migrated the last of them, so it is empty.
 * Paths are relative to src/, with forward slashes. Every entry existed before this plan.
 */
export const LEGACY: string[] = [];
const LEGACY_LIMIT = 0;

/** Lib files whose strings are lint data (the idiom list), never shown to a person. */
const NOT_UI = ["lib/literalLint.ts", "features/shims/fixtures.ts"];

/** Server, AI and data code (the production integration). Its strings are prompts, errors and logs, not UI copy. */
const NOT_UI_DIRS = [
  "features/auth/", "features/memory/", "features/shared/", "features/plan/", "features/practice/", "features/recap/",
  "features/sayit/", "features/share/", "features/support/", "features/state/",
  "lib/ai/", "lib/security/", "lib/api/", "lib/auth/", "lib/text/", "lib/telemetry/", "lib/supabase/",
  "lib/errors.ts", "lib/log.ts", "lib/crisis.ts", "lib/env.ts", "lib/requestContext.ts", "lib/storage.ts", "lib/storage-schema.ts",
];

/** Exact JSX text allowed to exceed three words. Empty: the footer legal line now comes from src/content/nav.ts. */
const ALLOW: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const files = walk(SRC)
  .filter((f) => /\.(ts|tsx|css)$/.test(f))
  .map((f) => ({ rel: relative(SRC, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));

type Hit = { rel: string; line: number; rule: string };

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const PATTERNS: [rule: string, re: RegExp, only?: RegExp][] = [
  ["backdrop-blur", /backdrop-blur/g],
  ["bg-gradient", /bg-gradient/g],
  ["text-transparent", /text-transparent/g],
  ["looping animation class", /animate-(pulse|bounce|spin)/g],
  ["infinite animation", /animation[^;{}]*infinite/g],
  [
    "Tailwind default palette colour",
    /\b(bg|text|border|ring|fill|stroke)-(red|blue|green|gray|slate|zinc|neutral|stone|purple|pink|indigo|violet|fuchsia|amber|yellow|orange|lime|teal|cyan|sky|emerald|rose)-\d{2,3}\b/g,
  ],
  ['href="#"', /href=(["'])#?\1/g],
  ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/g],
  ["emoji", /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, /\.tsx$/],
  ["empty onClick", /onClick=\{\s*(\(\s*\)\s*=>\s*(\{\s*\}|undefined)|undefined)\s*\}/g],
];

// Words are whitespace-separated tokens that contain a letter (any language). Text is skipped only when it
// shows obvious code markers, so the guard errs toward failing.
const CODE_MARKERS = /=>|&&|\|\||===|[{}]/;
const wordsOf = (s: string): string[] | null => {
  const cleaned = s
    .replace(/&#?\w+;/g, " ")
    .replace(/\{(?:[^{}]|\{[^{}]*\})*\}/g, " ")
    .trim();
  if (CODE_MARKERS.test(cleaned)) return null;
  return cleaned.split(/\s+/).filter((w) => /\p{L}/u.test(w));
};

// JSX text must start right after a real tag end: <a href="x">, <button onClick={() => go()}>, </b>, <>.
const BRACES = String.raw`\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}`;
const JSX_TEXT = new RegExp(String.raw`(?:<[A-Za-z][\w.]*(?=[\s/>])(?:[^<>{}]|${BRACES})*>|</[\w.]*>|<>)([^<>]+)(?=<)`, "g");

function jsxTextHits(rel: string, text: string): Hit[] {
  if (!/\.tsx$/.test(rel) || !/^(app|components)\//.test(rel)) return [];
  const hits: Hit[] = [];
  for (const m of text.matchAll(JSX_TEXT)) {
    const inner = m[1];
    if (ALLOW.includes(inner.trim().replace(/\s+/g, " "))) continue;
    const words = wordsOf(inner);
    if (words && words.length >= 4) hits.push({ rel, line: lineOf(text, m.index), rule: `JSX text of ${words.length} words` });
  }
  return hits;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function libStringHits(rel: string, text: string): Hit[] {
  if (!/^(lib|features)\/.*\.ts$/.test(rel) || NOT_UI.includes(rel) || NOT_UI_DIRS.some((d) => rel.startsWith(d))) return [];
  const hits: Hit[] = [];
  for (const m of stripComments(text).matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    const words = wordsOf(m[2].replace(/\$\{[^}]*\}/g, " "));
    if (words && words.length >= 4) hits.push({ rel, line: lineOf(text, m.index), rule: `string of ${words.length} words` });
  }
  return hits;
}

/** Every rule on one file. The self-test below runs fixture strings through it. */
function detect(rel: string, text: string): Hit[] {
  return [
    ...PATTERNS.flatMap(([rule, re, only]) =>
      only && !only.test(rel) ? [] : [...text.matchAll(re)].map((m) => ({ rel, line: lineOf(text, m.index), rule })),
    ),
    ...jsxTextHits(rel, text),
    ...libStringHits(rel, text),
  ];
}

const hits: Hit[] = files.flatMap(({ rel, text }) => detect(rel, text));

const isTest = (rel: string): boolean => /\.test\.tsx?$/.test(rel);

describe("style guard", () => {
  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("finds no new violations outside the legacy list", () => {
    const bad = hits.filter((h) => !LEGACY.includes(h.rel) && !isTest(h.rel));
    expect(bad.map((h) => `${h.rel}:${h.line} ${h.rule}`)).toEqual([]);
  });

  it("legacy list does not grow and has no stale entries", () => {
    expect(LEGACY.length).toBeLessThanOrEqual(LEGACY_LIMIT);
    for (const rel of LEGACY) expect(hits.some((h) => h.rel === rel), `${rel} no longer violates; remove it`).toBe(true);
  });
});

describe("style guard detector (self-test)", () => {
  const rules = (rel: string, text: string): string[] => detect(rel, text).map((h) => h.rule);
  const jsx = (inner: string): string[] => rules("components/Fixture.tsx", `export const F = () => <p>${inner}</p>;`);
  const isJsx = (r: string): boolean => r.startsWith("JSX text");
  const isStr = (r: string): boolean => r.startsWith("string of");

  it("flags 4+ word JSX text with parentheses, quotes, accents, dashes, slashes", () => {
    for (const t of [
      "Rumi helps you (and only you) get ready.",
      'Say "hello" to your helper today.',
      "Don’t worry, we will help you.",
      "Café résumé naïve façade.",
      "Rumi — your calm helper today",
      "Call us; we will answer soon.",
      "Read/write access for you + friends",
    ]) {
      expect(jsx(t).some(isJsx), t).toBe(true);
    }
  });

  it("flags text after a tag whose attribute holds an arrow function", () => {
    const f = "export const F = () => <button onClick={() => go()}>Save the plan right now</button>;";
    expect(rules("app/Fixture.tsx", f).some(isJsx)).toBe(true);
  });

  it("flags JSX text mixed with an expression", () => {
    expect(jsx("Hello {name} how are you").some(isJsx)).toBe(true);
  });

  it("does not flag short text, code, or files outside app/ and components/", () => {
    expect(jsx("Save the plan")).toEqual([]);
    expect(rules("components/F.tsx", "const f = (a: Array<string>) => { return a.length > 3 && ok }")).toEqual([]);
    expect(rules("lib/F.tsx", "export const F = () => <p>One two three four five</p>;")).toEqual([]);
  });

  it("flags a 4+ word string literal in src/lib and src/features", () => {
    for (const rel of ["lib/x.ts", "features/demo/x.ts"]) {
      expect(rules(rel, 'export const m = "Couldn’t save (try again later)";').some(isStr), rel).toBe(true);
    }
    expect(rules("lib/x.ts", "export const m = `Saved ${n} plans for you today`;").some(isStr)).toBe(true);
  });

  it("ignores short strings, comments and code-like strings in src/lib", () => {
    expect(rules("lib/x.ts", 'export const m = "Not saved";')).toEqual([]);
    expect(rules("lib/x.ts", "// this comment has many words in it\nexport const a = 1;")).toEqual([]);
    expect(rules("lib/x.ts", 'export const s = "try{ var a = b && c }catch(e){}";')).toEqual([]);
  });

  it("flags each banned pattern", () => {
    const cases: [string, string][] = [
      ["backdrop-blur", 'const c = "backdrop-blur-sm";'],
      ["bg-gradient", 'const c = "bg-gradient-to-r";'],
      ["text-transparent", 'const c = "text-transparent";'],
      ["looping animation class", 'const c = "animate-spin";'],
      ["infinite animation", ".a { animation: x 1s infinite; }"],
      ["Tailwind default palette colour", 'const c = "bg-blue-500";'],
      ['href="#"', 'const a = <a href="#">x</a>;'],
      ["dangerouslySetInnerHTML", "const a = <div dangerouslySetInnerHTML={{ __html: x }} />;"],
      ["emoji", "const a = <b>\u{1F600}</b>;"],
      ["empty onClick", "const a = <button onClick={() => {}}>x</button>;"],
    ];
    for (const [rule, text] of cases) {
      const rel = rule === "infinite animation" ? "app/x.css" : "components/x.tsx";
      expect(rules(rel, text), rule).toContain(rule);
    }
    expect(rules("components/x.tsx", 'const a = <a href="">x</a>;')).toContain('href="#"');
    expect(rules("components/x.tsx", "const a = <button onClick={undefined}>x</button>;")).toContain("empty onClick");
  });
});
