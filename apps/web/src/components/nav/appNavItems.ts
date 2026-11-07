import type { LucideIcon } from "lucide-react";
import { BookOpen, CalendarDays, ClipboardList, House, MessageCircle, Mic, Settings } from "@/components/ui/icons";
import { PAGES_COPY } from "@/content/pages";

type Item = { href: string; label: string; icon: LucideIcon; /** A shorter name for the narrow tab bar. */ tab?: string };

/** The seven tabs (under 1024 px) and the first seven sidebar items. Labels are the route titles. */
export const APP_NAV: readonly Item[] = [
  { href: "/home", label: PAGES_COPY["/home"].title, icon: House },
  { href: "/get-ready", label: PAGES_COPY["/get-ready"].title, icon: ClipboardList },
  { href: "/appointments", label: PAGES_COPY["/appointments"].title, icon: CalendarDays, tab: "Visits" },
  { href: "/practice", label: PAGES_COPY["/practice"].title, icon: MessageCircle },
  { href: "/record", label: PAGES_COPY["/record"].title, icon: Mic, tab: "Record" },
  { href: "/remember", label: PAGES_COPY["/remember"].title, icon: BookOpen },
  { href: "/settings", label: PAGES_COPY["/settings"].title, icon: Settings },
];
