import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  buildAppointment,
  callScript,
  icsFor,
  providersFor,
  slotsFor,
  splitAppointments,
  timeText,
  transcriptLines,
} from "@/features/appointments/appointments";
import { TranscriptLineSchema } from "@/features/shared/schemas";
import { KEY, loadState, saveState } from "@/lib/storage";
import { parseState } from "@/lib/storage-schema";
import { fakeStorage } from "./helpers/fakeStorage";

const NOW = new Date(2026, 10, 5, 9, 0); // Thursday 5 Nov 2026, local time
const lee = PROVIDERS[0]!;
const appt = (over = {}) => ({ ...buildAppointment({ care: "primary", provider: lee, slot: { date: "2026-11-09", time: "10:30" }, reason: "Headaches." }, "a-1", NOW), ...over });

describe("booking", () => {
  it("has six made-up providers and filters by care", () => {
    expect(PROVIDERS).toHaveLength(6);
    expect(providersFor("dentist").map((p) => p.id)).toEqual(["park"]);
    expect(providersFor("other")).toHaveLength(6);
  });
  it("offers five weekdays after today, never a weekend", () => {
    const slots = slotsFor(lee, NOW);
    expect(slots).toHaveLength(15);
    expect(slots[0]!.date).toBe("2026-11-06");
    expect(new Set(slots.map((s) => s.date))).toEqual(new Set(["2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]));
  });
  it("builds an appointment that waits for the office", () => {
    const a = appt();
    expect(a).toMatchObject({ id: "a-1", care: "primary", providerName: "Dr. Maya Lee", clinic: "Northside Health Center", date: "2026-11-09", time: "10:30", status: "to_confirm", questions: [], bring: [], symptoms: [] });
  });
  it("writes the call script from the appointment", () => {
    const text = callScript(appt(), "Sam");
    expect(text).toContain("Hi, my name is Sam.");
    expect(text).toContain("primary care visit with Dr. Maya Lee at Northside Health Center");
    expect(text).toContain("Monday, November 9 at 10:30 am");
    expect(text).toContain("The visit is about this: Headaches.");
    expect(callScript(appt({ reason: "" }), "")).toContain("[your name]");
  });
  it("formats times and the calendar file", () => {
    expect(timeText("00:05")).toBe("12:05 am");
    expect(timeText("14:00")).toBe("2:00 pm");
    const ics = icsFor(appt(), NOW);
    expect(ics).toContain("DTSTART:20261109T103000");
    expect(ics).toContain("DTEND:20261109T113000");
    expect(ics).toContain("SUMMARY:Primary care visit with Dr. Maya Lee");
    expect(ics).toContain("DESCRIPTION:Confirm this time with the office. Headaches.");
    expect(icsFor(appt({ reason: "a, b; c" }), NOW)).toContain("a\\, b\\; c");
  });
  it("splits upcoming (soonest first) from past (latest first)", () => {
    const a = appt({ id: "x1", date: "2026-11-20" });
    const b = appt({ id: "x2", date: "2026-11-08" });
    const c = appt({ id: "x3", date: "2026-10-01" });
    const d = appt({ id: "x4", date: "2026-11-04" });
    const { upcoming, past } = splitAppointments([a, c, b, d], NOW);
    expect(upcoming.map((x) => x.id)).toEqual(["x2", "x1"]);
    expect(past.map((x) => x.id)).toEqual(["x4", "x3"]);
  });
});

describe("transcriptLines", () => {
  it("makes valid recap lines marked A, grouped under the length limit", () => {
    const lines = transcriptLines("Hello Sam. How are you?\nTake a break every hour. " + "Drink water. ".repeat(100));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(60);
    for (const l of lines) expect(TranscriptLineSchema.safeParse(l).success).toBe(true);
    expect(lines[0]!.speaker).toBe("A");
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  });
  it("gives no lines for empty text", () => expect(transcriptLines("  \n ")).toEqual([]));
});

describe("storage of appointments and visits", () => {
  it("round-trips through save and load", () => {
    const store = fakeStorage();
    const state = { ...parseState({ version: 1 }), version: 1 as const };
    const withData = { ...loadState(store), appointments: [appt({ questions: ["Is this normal?"] })], visits: [{ id: "v-1", apptId: "a-1", createdAt: "2026-11-09T10:00:00.000Z", text: "Hello." }] };
    expect(state.appointments).toBeUndefined();
    expect(saveState(withData, store).ok).toBe(true);
    const back = loadState(store);
    expect(back.appointments).toEqual(withData.appointments);
    expect(back.visits).toEqual(withData.visits);
    expect(store.getItem(KEY)).toContain("Is this normal?");
  });
  it("drops garbage and keeps the rest", () => {
    const raw = {
      version: 1,
      appointments: [appt(), { id: "bad id!", date: "x" }, "nope", { ...appt({ id: "a-2" }), date: "tomorrow" }, { ...appt({ id: "a-3" }), status: "weird", care: "magic", questions: "no" }],
      visits: [{ id: "v-1", createdAt: "x", text: "Hi." }, { id: "v-2", createdAt: "x", text: "   " }, 7],
    };
    const s = parseState(raw);
    expect(s.appointments?.map((a) => a.id)).toEqual(["a-1", "a-3"]);
    expect(s.appointments?.[1]).toMatchObject({ status: "to_confirm", care: "other", questions: [] });
    expect(s.visits).toEqual([{ id: "v-1", createdAt: "x", text: "Hi." }]);
    expect(parseState({ version: 1, appointments: "x", visits: { a: 1 } }).appointments).toBeUndefined();
  });
  it("caps the lists", () => {
    const many = Array.from({ length: 80 }, (_, i) => appt({ id: `a-${i}` }));
    expect(parseState({ version: 1, appointments: many }).appointments).toHaveLength(50);
  });
});
