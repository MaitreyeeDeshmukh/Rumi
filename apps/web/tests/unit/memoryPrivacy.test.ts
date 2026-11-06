import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEMORY_COPY } from "@/features/memory/consentCopy";
import { literalLint } from "@/lib/literalLint";
import { fakeMemoryDb } from "./helpers/fakeMemoryDb";
import { memoryDevice, practice, preset } from "./helpers/memoryDevice";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("what leaves the device and what the database holds", () => {
  it("a plan full of private text never reaches the network or the database: preset ids and levels only", async () => {
    const secrets = ["HIV test", "sertraline", "panic attacks", "Karen", "Okafor", "Priya Raman"];
    const db = fakeMemoryDb();
    const d = memoryDevice(db, { card: [preset("p1"), preset("p2")] });
    d.store.update((x) => {
      x.settings.name = "Priya Raman";
      x.plan = {
        id: "plan-1",
        title: "Dr. Okafor visit",
        createdAt: "2026-11-05T09:00:00.000Z",
        mainConcern: "I want an HIV test and I take sertraline",
        symptomsInMyWords: ["panic attacks", "my landlord Karen"],
        items: [{ id: "q1", text: "Can I stop sertraline?", kind: "question", source: "user", enabled: true }],
      };
      x.supportCard = {
        id: "c",
        topQuestionIds: [],
        items: [preset("p1"), { id: "u1", text: "I have panic attacks, ask Dr. Okafor", source: "user", enabled: true }],
      };
      x.sessions = [{ ...practice("s", "2026-11-05T08:00:00.000Z", { question: 2 }), turns: [{ role: "me", text: "I take sertraline" }] }];
    });
    await d.actions.enableMemory();
    const everything = JSON.stringify(d.calls) + JSON.stringify([...db.rows.values()]) + JSON.stringify(db.batches);
    for (const secret of secrets) expect(everything).not.toContain(secret);
    expect(db.rows.size).toBeGreaterThan(0);
    for (const r of db.rows.values()) expect(Object.keys(r).sort()).toEqual(["client_updated_at", "key", "kind", "level"]);
  });
});

describe("Supermemory stays in its own files", () => {
  // Supermemory is back as the semantic recall layer (server only). Only these files may name it or its variables; the old recovery code stays gone everywhere.
  const SUPERMEMORY_FILES = ["src/features/memory/", "src/lib/ai/harness.ts", "src/lib/env.ts", "tests/unit/supermemory.test.ts"];
  const needles = [["super", "memory"].join(""), ["SUPERMEMORY", "API_KEY"].join("_"), ["MEMORY", "TAG", "SECRET"].join("_"), ["recovery", "Code"].join("")];

  // These three tests prove that an old variable or an old stored code is ignored, so they have to name it.
  const PROVES_IGNORED = ["env.test.ts", "stateStore.test.ts", "storage.test.ts"];

  it("no source, test or fixture mentions it, the old environment variables, or the recovery code", () => {
    const here = fileURLToPath(import.meta.url);
    const hits: string[] = [];
    for (const dir of ["src", "tests", "prompts"]) {
      for (const file of filesUnder(join(ROOT, dir))) {
        if (file === here || PROVES_IGNORED.some((n) => file.endsWith(n)) || !/\.(ts|tsx|json|mjs)$/.test(file)) continue;
        const text = readFileSync(file, "utf8").toLowerCase();
        const allowed = SUPERMEMORY_FILES.some((p) => file.replaceAll("\\", "/").includes(p));
        for (const [i, n] of needles.entries()) if (!(allowed && i < 3) && text.includes(n.toLowerCase())) hits.push(`${file.slice(ROOT.length)}: ${n}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("the memory words", () => {
  it("every sentence is short and plain, and none names another company or a code to keep", () => {
    const sentences = [MEMORY_COPY.title, ...MEMORY_COPY.body, MEMORY_COPY.toggle, MEMORY_COPY.saved, MEMORY_COPY.paused, MEMORY_COPY.failed, MEMORY_COPY.forgetButton, MEMORY_COPY.forgetConfirm, MEMORY_COPY.forgetFailed];
    for (const s of sentences) expect(literalLint(s).failures, s).toEqual([]);
    const all = sentences.join(" ").toLowerCase();
    expect(all).not.toMatch(/supermemory|recovery code|third part/);
    expect(all).toContain("rumi");
    expect(all).toContain("delete everything at any time");
    expect(all).toMatch(/only the id of each choice/);
  });
});
