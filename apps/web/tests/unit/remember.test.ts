import { describe, expect, it } from "vitest";
import { SAMPLE_VISIT, SAVED_RECAP_REPLY } from "@/features/shims/fixtures";
import { buildRecap, groupItems, quoted, unconfirmedText, voicesOf } from "@/features/shims/remember";

describe("remember builders", () => {
  it("lists each voice once with its first line", () => {
    const v = voicesOf(SAMPLE_VISIT);
    expect(v.map((x) => x.speaker)).toEqual(["A", "B", "C"]);
    expect(v[1].first).toBe("They feel tight behind my eyes. They get worse after class.");
  });

  it("groups items by section in reading order and hides empty sections", () => {
    const g = groupItems(SAVED_RECAP_REPLY.items);
    expect(g.map((x) => x.section)).toEqual(["discussed", "instructions", "medications", "next_steps"]);
    expect(groupItems(SAVED_RECAP_REPLY.items.filter((i) => i.section === "medications")).length).toBe(1);
    expect(groupItems([])).toEqual([]);
  });

  it("keeps the item index so the right item is highlighted", () => {
    const g = groupItems(SAVED_RECAP_REPLY.items);
    expect(g[1].items.map((x) => x.index)).toEqual([2, 3]);
  });

  it("strips the confirm lead and quotes lines", () => {
    expect(unconfirmedText("I could not confirm this: The screen.")).toBe("The screen.");
    expect(unconfirmedText("Plain.")).toBe("Plain.");
    expect(quoted("Hi")).toBe("\u201cHi\u201d");
  });

  it("builds a sample recap and marks the saved example", () => {
    const r = buildRecap(SAVED_RECAP_REPLY, "B", true);
    expect(r.isSample).toBe(true);
    expect(r.isSavedFallback).toBe(true);
    expect(r.mySpeaker).toBe("B");
    expect(r.transcript).toHaveLength(SAMPLE_VISIT.length);
  });
});
