// Copy for the visit tools under /home/visits (preview). The summary points at lines of SAMPLE_VISIT.

export const VISITS = {
  title: "Your visits",
  lead: "Record a visit, then read a short summary. Your past visits stay here.",
  record: "Record a visit",
  pastTitle: "Past visits",
  sampleTitle: "Sample visit with Dr. Lee",
  sampleTag: "Sample",
  recordedTag: "Recorded in preview",
  minutes: "{n} min",
  noneYet: "You have not recorded a visit yet. The sample shows what a summary looks like.",

  recordTitle: "Record a visit",
  recordLead: "Ask first. Then Rumi listens and writes a short summary for you.",
  askTitle: "Ask before you record",
  askText: "Always ask the clinician first. Some offices do not allow recording.",
  askSay: "You can say: Is it okay if I record this visit so I remember it?",
  consent: "The clinician said yes to recording",
  consentNeeded: "Check the box when the clinician says yes.",
  nameLabel: "Name this visit",
  nameHint: "For example, the clinician or the reason.",
  nameDefault: "Visit with Dr. Lee",
  apptLabel: "Which appointment is this?",
  apptNone: "Not linked to an appointment",
  start: "Start recording",
  recording: "Recording",
  paused: "Paused",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop and save",
  previewMic: "No sound is recorded. Rumi uses the sample visit for the summary.",
  timerLabel: "Time recorded",

  detailLead: "Here is what Rumi heard. Check anything important with your clinician.",
  previewSummary: "This summary comes from the sample visit, not from your recording.",
  showSource: "Show where this came from",
  hideSource: "Hide where this came from",
  fullVisit: "The full visit",
  showFull: "Show the full visit",
  hideFull: "Hide the full visit",
  getReady: "Get ready for the follow-up",
  deleteVisit: "Delete this visit",
  deleteConfirm: "Yes, delete it",
  deleteCancel: "Keep it",
  deleteNote: "This deletes the visit from this device.",
  sampleNoDelete: "The sample visit cannot be deleted.",
  copy: "Copy summary",
  copied: "Summary copied.",
  copyFailed: "Copy did not work. Select the text and copy it yourself.",
} as const;

export const SPEAKERS: Readonly<Record<string, string>> = { A: "Dr. Lee", B: "You", C: "Mom" };

/** Summary of SAMPLE_VISIT. Each item lists the line ids it came from. */
export const VISIT_SUMMARY: readonly { key: string; title: string; items: readonly { text: string; lines: readonly string[] }[] }[] = [
  {
    key: "discussed",
    title: "What we talked about",
    items: [
      { text: "Headaches most afternoons for about three weeks.", lines: ["l2"] },
      { text: "They feel tight behind your eyes and get worse after class.", lines: ["l4"] },
      { text: "Lying down in a dark room helps a little.", lines: ["l6"] },
      { text: "Blood pressure looked normal. There is no clear cause yet.", lines: ["l8"] },
    ],
  },
  {
    key: "instructions",
    title: "What to do",
    items: [
      { text: "Keep a headache diary for two weeks.", lines: ["l9"] },
      { text: "Write down when each headache starts and how strong it is.", lines: ["l9"] },
      { text: "The clinician will print the instructions for you.", lines: ["l10", "l11"] },
    ],
  },
  {
    key: "medications",
    title: "Medicines mentioned",
    items: [{ text: "Ibuprofen if you need it. Follow the package directions.", lines: ["l12"] }],
  },
  {
    key: "next",
    title: "Next steps",
    items: [
      { text: "Come back in four weeks.", lines: ["l14"] },
      { text: "Bring the diary with you.", lines: ["l14"] },
      { text: "Book the follow-up at the front desk.", lines: ["l16"] },
    ],
  },
  {
    key: "clarify",
    title: "Questions to ask",
    items: [
      { text: "One line was not clear. Ask what was said about the school screen.", lines: ["l13"] },
      { text: "How much ibuprofen is okay, and how often?", lines: ["l12"] },
    ],
  },
];
