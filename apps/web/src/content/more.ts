// Copy for the preview hub at /home/more and the shared preview parts. Every sentence is 15 words or fewer.

export const MORE = {
  title: "More in Rumi",
  lead: "Early versions of more Rumi tools. They use sample data and stay on this device.",
  previewTitle: "Preview",
  previewText: "This part of Rumi is a preview. It uses made-up data. Nothing is sent anywhere.",
  sectionsTitle: "Preview tools",
  open: "Open",
  eraseTitle: "Erase preview data",
  eraseText: "This deletes what you added in these preview tools on this device. Your plan and settings stay.",
  eraseButton: "Erase preview data",
  eraseConfirm: "Yes, erase it",
  eraseCancel: "Keep it",
  erased: "Preview data erased.",
  back: "Back to More",
  notFoundTitle: "We could not find that",
  notFoundText: "It may have been deleted on this device.",
  loading: "Loading",
  delete: "Delete",
  save: "Save",
  cancel: "Cancel",
} as const;

/** One card on the hub. Added as each preview tool is built. */
export const MORE_SECTIONS: readonly { href: string; title: string; text: string }[] = [
  { href: "/home/visits", title: "Your visits", text: "Record a visit and get a short summary. See past visits." },
  { href: "/home/appointments", title: "Appointments", text: "Add appointments, see what is coming up and get a call script." },
  { href: "/home/circles", title: "Circles", text: "Small groups with clear plans. Talking is always optional." },
  { href: "/home/contacts", title: "Trusted contacts", text: "People you might want to text or call fast." },
  { href: "/home/growth", title: "My growth", text: "A private record of things you tried. No scores." },
];

/** Browser tab titles for each preview route (the first path segment after /home). */
export const MORE_TITLES: Readonly<Record<string, string>> = {
  more: "More in Rumi",
  visits: "Your visits",
  appointments: "Appointments",
  circles: "Circles",
  contacts: "Trusted contacts",
  growth: "My growth",
};
