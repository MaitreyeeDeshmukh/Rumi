// /welcome copy (spec 4.8 and plan 04). tests/unit/copy.test.ts lints every string.
export const WELCOME = {
  skip: "Skip for now",
  start: "Start",
  nameLabel: "What should I call you?",
  helperLabel: "Name your helper",
  helperDefault: "Rumi",
  infoLegend: "How do you like to get information?",
  outputLabel: "Read, listen, or both",
  output: { read: "Read", listen: "Listen", both: "Both" },
  detailLabel: "Short or detailed",
  detail: { short: "Short", detailed: "Detailed" },
  lookLegend: "Pick how it looks",
  lookHint: {
    soft: "Calm and light.",
    contrast: "Strong lines and dark text.",
    low: "Dark and quiet.",
  },
  later: "You can change this later in Settings.",
} as const;
