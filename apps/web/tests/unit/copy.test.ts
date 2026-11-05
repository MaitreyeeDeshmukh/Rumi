import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COPY, LINT_EXEMPT } from "@/components/copy";

/** Flatten COPY into key -> sentence. Functions are called with sample values so their output is checked too. */
function walk(node: unknown, key: string, out: Map<string, string>): void {
  if (typeof node === "string") { out.set(key, node); return; }
  if (typeof node === "function") {
    const sample = (node as (...a: unknown[]) => unknown).length === 2 ? (node as (a: unknown, b: unknown) => unknown)(2, 4) : (node as (a: unknown) => unknown)("Sam");
    if (typeof sample === "string") out.set(key, sample);
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${key}.${i}`, out)); return; }
  if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, key ? `${key}.${k}` : k, out);
}

const strings = new Map<string, string>();
walk(COPY, "", strings);

describe("UI copy", () => {
  it("has no empty or banned text", () => {
    const banned = /lorem ipsum|\bTODO\b|placeholder|coming soon|undefined|\[object Object\]/i;
    for (const [k, v] of strings) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      expect(v, k).not.toMatch(banned);
    }
  });

  it("keeps the contract 4.10 fixed strings exact", () => {
    expect(COPY.common.footer).toBe("Rumi is an AI helper. It is not a doctor.");
    expect(COPY.practice.banner).toBe("This is practice. Not a real doctor.");
    expect(COPY.share.noSend).toBe("Rumi does not send anything. You decide.");
    expect(COPY.remember.saved).toBe("Saved example (live AI unavailable).");
    expect(COPY.remember.sampleLabel).toBe("Sample visit, made by our team");
    expect(COPY.remember.footer).toBe("Check anything important with your clinician.");
    expect(COPY.crisis.body).toBe("If you might hurt yourself or you are in danger, call or text 988 (US) or call 911. Rumi is not an emergency service.");
  });

  it("only exempts keys that exist", () => {
    for (const k of LINT_EXEMPT) expect(strings.has(k), k).toBe(true);
  });

  // Uses Aakash's literalLint (lane/features). Runs as soon as src/lib/literalLint.ts is merged.
  const lintPath = resolve(__dirname, "../../src/lib/literalLint.ts");
  it.skipIf(!existsSync(lintPath))("passes the same literal lint the AI must pass", async () => {
    const mod = (await import(/* @vite-ignore */ lintPath)) as { literalLint: (t: string) => { failures: unknown[] } };
    const bad: string[] = [];
    for (const [k, v] of strings) {
      if (LINT_EXEMPT.includes(k)) continue;
      const r = mod.literalLint(v);
      if (r.failures.length) bad.push(`${k}: ${JSON.stringify(r.failures)}`);
    }
    expect(bad).toEqual([]);
  });
});
