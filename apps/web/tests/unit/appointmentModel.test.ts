import { describe, expect, it } from "vitest";
import { parseState } from "@/lib/storage-schema";

const base = {
  id: "a-1",
  care: "specialist",
  providerName: "Riverside Medical Center",
  clinic: "Cardiology",
  date: "2026-04-14",
  time: "10:30",
  reason: "Check my heart",
  status: "to_confirm",
  createdAt: "2026-04-01T10:00:00.000Z",
  questions: [],
  bring: [],
  symptoms: [],
};
const state = (extra: Record<string, unknown>) => ({ version: 1, settings: {}, sessions: [], persona: { facts: [] }, ...extra });

describe("appointment record fields", () => {
  it("keeps source, address, instructions, documents and checklist through a reload", () => {
    const raw = state({
      appointments: [
        {
          ...base,
          source: "scanned",
          address: "42 Oak Street",
          department: "Cardiology",
          instructions: ["Arrive 15 minutes early"],
          documents: [{ id: "d-1", kind: "image", name: "letter.png", createdAt: "2026-04-01", excerpt: "Riverside...", confirmed: true }],
          checklist: [{ id: "c-1", text: "Photo ID", source: "letter", done: true }],
        },
      ],
    });
    const a = parseState(raw).appointments?.[0];
    expect(a?.source).toBe("scanned");
    expect(a?.address).toBe("42 Oak Street");
    expect(a?.instructions).toEqual(["Arrive 15 minutes early"]);
    expect(a?.documents?.[0]).toMatchObject({ kind: "image", confirmed: true });
    expect(a?.checklist?.[0]).toMatchObject({ text: "Photo ID", source: "letter", done: true });
  });

  it("leaves the new fields out of an old appointment", () => {
    const a = parseState(state({ appointments: [base] })).appointments?.[0];
    expect(a).toBeDefined();
    for (const k of ["source", "address", "department", "instructions", "documents", "checklist"]) expect(a).not.toHaveProperty(k);
  });

  it("drops a checklist link that is not https and an unknown source", () => {
    const raw = state({
      appointments: [{ ...base, source: "mystery", checklist: [{ id: "c-1", text: "Bring forms", source: "hospital", done: false, url: "javascript:alert(1)" }] }],
    });
    const a = parseState(raw).appointments?.[0];
    expect(a).not.toHaveProperty("source");
    expect(a?.checklist?.[0]).not.toHaveProperty("url");
  });
});

describe("chat threads", () => {
  it("keeps threads with messages and drops empty ones", () => {
    const raw = state({
      chats: [
        { id: "t-1", kind: "get-ready", apptId: "a-1", createdAt: "x", updatedAt: "y", messages: [{ role: "me", text: "My knee hurts" }, { role: "rumi", text: "Since when?" }] },
        { id: "t-2", kind: "practice", createdAt: "x", updatedAt: "y", messages: [] },
      ],
    });
    const chats = parseState(raw).chats;
    expect(chats).toHaveLength(1);
    expect(chats?.[0]).toMatchObject({ id: "t-1", apptId: "a-1" });
    expect(chats?.[0].messages).toHaveLength(2);
  });

  it("is absent when there are no chats", () => {
    expect(parseState(state({})).chats).toBeUndefined();
  });
});
