import { describe, expect, it } from "vitest";
import { crisisTier } from "@/lib/crisis";

// P3: ordinary sentences that read like a tier 1 rule. They must not show the card; they may still reach the classifier (check) or nothing (none).
const BENIGN = [
  "My son stopped breathing exercises because they were boring",
  "My daughter stopped breathing practice after one class",
  "I was shot with a vaccine in my left arm",
  "I got shot with the flu vaccine at the clinic",
  "I was told about a lethal dose warning on the label",
  "The lethal dose information is printed on the box",
  "I feel like I am going to die in the chair",
  "I feel like I am going to die in the dentist chair",
  "I think I am going to die in this waiting room, it is so long",
];

// The real thing, worded close to the benign ones. Every one keeps the card.
const REAL = [
  "My son stopped breathing",
  "My son stopped breathing and his lips are blue",
  "My toddler stopped breathing a minute ago",
  "I was shot",
  "I was shot in the leg",
  "I was shot with a gun last night",
  "I was shot with a pistol",
  "What is the lethal dose of tylenol",
  "lethal dose",
  "lethal dose of ibuprofen for my weight",
  "I feel like I am going to die",
  "I am going to die in my room tonight",
  "I feel like I am going to die in my sleep",
  "I want to die in the cold",
];

describe("tier 1 vetoes for everyday sentences (P3)", () => {
  it.each(BENIGN)("no card: %j", (s) => {
    expect(crisisTier(s)).not.toBe("certain");
  });

  it.each(REAL)("still the card: %j", (s) => {
    expect(crisisTier(s)).toBe("certain");
  });
});
