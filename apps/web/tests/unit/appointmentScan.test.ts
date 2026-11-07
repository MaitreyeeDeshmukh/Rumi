import { describe, expect, it } from "vitest";
import { appointmentScanSpec } from "@/features/appointmentScan/spec";
import { dateInText, groundFields, timeInText } from "@/features/appointmentScan/ground";
import { scanByRules } from "@/features/appointmentScan/rules";
import { buildScannedAppointment } from "@/features/appointmentScan/toAppointment";
import { buildChecklist } from "@/features/checklist/buildChecklist";
import { SAMPLE_LETTER } from "@/fixtures/sampleLetter";
import { cleanItem } from "@/lib/lookup/lookupHandler";
import { imageMime } from "@/lib/vision/photo";
import { safeHttpsUrl, sourcesFrom } from "@/lib/lookup/search";

const TODAY = new Date(2026, 10, 6);

describe("grounding", () => {
  it("finds dates and times written in common ways", () => {
    expect(dateInText("2026-11-16", SAMPLE_LETTER)).toBe(true);
    expect(dateInText("2026-11-17", SAMPLE_LETTER)).toBe(false);
    expect(timeInText("09:30", SAMPLE_LETTER)).toBe(true);
    expect(timeInText("14:00", "Come at 2 pm")).toBe(true);
    expect(timeInText("10:00", SAMPLE_LETTER)).toBe(false);
  });

  it("blanks anything the letter does not say", () => {
    const f = groundFields(
      { provider: "Dr. Sam Okafor", clinic: "Northside Health Center", date: "2026-12-01", time: "09:30", address: "1500 Oak Street", department: "Cardiology", reason: "", instructions: ["Bring a kidney"], bring: ["Your photo ID", "A parachute"] },
      SAMPLE_LETTER,
    );
    expect(f).toMatchObject({ provider: "", clinic: "Northside Health Center", date: "", time: "09:30", address: "", department: "Cardiology", instructions: [], bring: ["Your photo ID"] });
  });
});

describe("rules reader and spec", () => {
  it("reads the sample letter", () => {
    const f = scanByRules(SAMPLE_LETTER, TODAY);
    expect(f).toMatchObject({ provider: "Dr. Maya Lee", clinic: "Northside Health Center", date: "2026-11-16", time: "09:30", department: "Cardiology" });
    expect(f.bring).toEqual(["Your photo ID", "Your insurance card", "A list of your medicines", "The enclosed form"]);
  });

  it("mock and fallback satisfy the reply schema; redaction is off; a model answer with nothing grounded is a failed attempt", () => {
    const r = { text: SAMPLE_LETTER, companionName: "Rumi" };
    expect(appointmentScanSpec.reply.safeParse(appointmentScanSpec.mock(r)).success).toBe(true);
    expect(appointmentScanSpec.reply.safeParse(appointmentScanSpec.fallback(r)).success).toBe(true);
    expect(appointmentScanSpec.skipRedaction).toBe(true);
    const empty = appointmentScanSpec.modelOut.parse({ provider: "Dr. Nobody" });
    expect(appointmentScanSpec.validate(r, empty, appointmentScanSpec.buildLedger(r))).toEqual(["empty"]);
  });
});

describe("checklist", () => {
  const scanned = () =>
    buildScannedAppointment(
      { care: "specialist", provider: "Dr. Maya Lee", clinic: "Northside", date: "2026-11-16", time: "09:30", address: "", department: "", reason: "", instructions: "", bring: "Photo ID\nInsurance card", text: SAMPLE_LETTER, docKind: "text", docName: "Pasted letter" },
      "a-1",
      "d-1",
      TODAY,
    );

  it("letter items win and nothing else is added; no image bytes are saved", () => {
    const a = scanned();
    expect(a.source).toBe("scanned");
    expect(a.checklist?.map((i) => [i.text, i.source])).toEqual([["Photo ID", "letter"], ["Insurance card", "letter"]]);
    expect(a.documents?.[0]).toMatchObject({ kind: "text", confirmed: true });
    expect(buildChecklist(a, [{ text: "Wear a mask", url: "https://x.example.org/p" }])).toHaveLength(2);
  });

  it("with no letter, the common list is built once, hospital items replace it, and a tick is kept", () => {
    const base = { ...scanned(), checklist: undefined, documents: undefined };
    const first = buildChecklist(base);
    expect(first.every((i) => i.source === "suggested")).toBe(true);
    const ticked = first.map((i, n) => ({ ...i, done: n === 0 }));
    const withHospital = buildChecklist({ ...base, checklist: ticked }, [{ text: "Bring your referral", url: "https://x.example.org/p" }]);
    expect(withHospital.map((i) => i.source)).toEqual(["hospital"]);
    expect(buildChecklist({ ...base, checklist: [] })).toEqual([]);
  });
});

describe("photo and lookup guards", () => {
  it("accepts only real pictures by their first bytes", () => {
    expect(imageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer)).toBe("image/jpeg");
    expect(imageMime(new TextEncoder().encode("<html>not a picture</html>").buffer)).toBeNull();
  });

  it("links come from the tool record, https only", () => {
    expect(safeHttpsUrl("http://a.example.org")).toBeNull();
    expect(safeHttpsUrl("https://localhost/x")).toBeNull();
    expect(sourcesFrom([{ type: "browser_search", search_results: { results: [{ url: "https://b.example.org/1" }] } }, { type: "browser.open", search_results: { results: [{ url: "https://a.example.org/0" }] } }])).toEqual(["https://a.example.org/0", "https://b.example.org/1"]);
  });

  it("drops model items with links or doses", () => {
    expect(cleanItem("Bring your ID. See https://evil.example.com now")).not.toContain("http");
    expect(cleanItem("Take 500 mg of ibuprofen daily")).toBeNull();
    expect(cleanItem("Bring your insurance card.")).toBe("Bring your insurance card.");
  });
});
