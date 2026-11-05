export const SITE = {
  name: "Rumi",
  tagline: "Your world. Your pace. Your way.",
  description:
    "Rumi is a calm companion for neurodivergent young adults: prepare for health visits, practice conversations, get help when plans change, and find your people.",
} as const;

export interface NavLink {
  href: string;
  label: string;
}

export const MAIN_NAV: readonly NavLink[] = [
  { href: "/", label: "Home" },
  { href: "/safety", label: "Safety" },
  { href: "/help", label: "Help" },
];

export const FOOTER_NAV: readonly NavLink[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/safety", label: "Safety and crisis help" },
  { href: "/help", label: "Help" },
  { href: "/preview/index.html", label: "Try the preview" },
];

/** Every internal route the app serves. Tests check each one exists and works. */
export const ROUTES: readonly string[] = [
  "/",
  "/safety",
  "/help",
  "/privacy",
  "/accessibility",
];
