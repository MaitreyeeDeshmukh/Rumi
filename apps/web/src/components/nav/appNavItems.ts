import type { LucideIcon } from "lucide-react";
import { BookOpen, ClipboardList, House, MessageCircle, MessageSquareText, Settings } from "@/components/ui/icons";
import { PAGES_COPY } from "@/content/pages";

type Item = { href: string; label: string; icon: LucideIcon };

/** The five tabs (under 1024 px) and the first five sidebar items. Labels are the route titles. */
export const APP_NAV: readonly Item[] = [
  { href: "/home", label: PAGES_COPY["/home"].title, icon: House },
  { href: "/get-ready", label: PAGES_COPY["/get-ready"].title, icon: ClipboardList },
  { href: "/practice", label: PAGES_COPY["/practice"].title, icon: MessageCircle },
  { href: "/remember", label: PAGES_COPY["/remember"].title, icon: BookOpen },
  { href: "/settings", label: PAGES_COPY["/settings"].title, icon: Settings },
];

/** Reached from the dashboard and Practice; in the sidebar only, not a tab. */
export const SAY_IT: Item = { href: "/say-it", label: PAGES_COPY["/say-it"].title, icon: MessageSquareText };
