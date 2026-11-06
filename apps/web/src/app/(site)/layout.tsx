import type { ReactNode } from "react";
import { SiteChrome } from "@/components/nav/SiteChrome";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
