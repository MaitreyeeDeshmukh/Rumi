import { NAV } from "@/content/nav";
import { PAGES_COPY } from "@/content/pages";

export const SITE = {
  name: "Rumi",
  tagline: PAGES_COPY["/"].h1,
  description: PAGES_COPY["/"].description,
} as const;

export interface NavLink {
  href: string;
  label: string;
}

const HOW: NavLink = { href: "/how-it-works", label: NAV.howItWorks };
const ABOUT: NavLink = { href: "/about", label: NAV.about };
const OPEN: NavLink = { href: "/welcome", label: NAV.openRumi };
const SAFETY: NavLink = { href: "/safety", label: NAV.safety };
const PRIVACY: NavLink = { href: "/privacy", label: NAV.privacy };
const ACCESS: NavLink = { href: "/accessibility", label: NAV.accessibility };
const HELP: NavLink = { href: "/help", label: NAV.help };
const CONTACT: NavLink = { href: "/contact", label: NAV.contact };

export const MAIN_NAV: readonly NavLink[] = [HOW, SAFETY, HELP, CONTACT];

export const FOOTER_COLUMNS: readonly { title: string; links: readonly NavLink[] }[] = [
  { title: NAV.columnRumi, links: [HOW, ABOUT, OPEN] },
  { title: NAV.columnTrust, links: [SAFETY, PRIVACY, ACCESS] },
  { title: NAV.columnHelp, links: [HELP, CONTACT] },
];

export const FOOTER_LINKS: readonly NavLink[] = FOOTER_COLUMNS.flatMap((c) => c.links);

/** The information pages the app also links to (app footer and sidebar, Task 10). */
export const INFO_LINKS: readonly NavLink[] = [
  HELP,
  CONTACT,
  PRIVACY,
  ACCESS,
  { href: "/safety", label: NAV.safetyFull },
];

/** Every internal route the app serves. Tests check each one exists and works. Each later task adds its own. */
export const ROUTES: readonly string[] = [
  "/",
  "/how-it-works",
  "/about",
  "/contact",
  "/help",
  "/safety",
  "/privacy",
  "/accessibility",
  "/welcome",
  "/home",
  "/get-ready",
  "/practice",
  "/remember",
  "/share",
  "/kit",
  "/say-it",
  "/settings",
  "/appointments",
  "/appointments/new",
  "/appointment",
  "/record",
];
