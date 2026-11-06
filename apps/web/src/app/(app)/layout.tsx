import Link from "next/link";
import type { ReactNode } from "react";
import { AppBar } from "@/components/nav/AppBar";
import { AppFooter } from "@/components/nav/AppFooter";
import { AppShell } from "@/components/nav/AppShell";
import { NAV } from "@/content/nav";

// Every app screen wraps its interactive content in an element with data-needs-js; without JavaScript this hides it.
const HIDE_NEEDS_JS = "[data-needs-js]{display:none}";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      bar={<AppBar />}
      footer={<AppFooter />}
      noJs={
        <noscript>
          <style>{HIDE_NEEDS_JS}</style>
          <p>{NAV.needsJs}</p>
          <Link href="/">{NAV.goHome}</Link>
        </noscript>
      }
    >
      {children}
    </AppShell>
  );
}
