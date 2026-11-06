import Link from "next/link";
import { Logo } from "@/components/nav/Logo";
import { MenuSheet } from "@/components/nav/MenuSheet";
import { ButtonLink } from "@/components/ui/button";
import { OpenRumiButton } from "@/components/nav/OpenRumiButton";
import { NAV } from "@/content/nav";
import { MAIN_NAV } from "@/lib/site";

/** Logo, the four links from 1024 px up, Urgent help, Open Rumi (1024 px up) and Menu (under 1024 px). */
export function SiteHeader() {
  return (
    <header className="no-print border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-[var(--main-max)] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
        <Logo />
        <nav aria-label={NAV.mainLabel} className="hidden lg:flex lg:gap-1">
          {MAIN_NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex min-h-11 items-center rounded-control px-3 font-bold text-ink no-underline hover:bg-lav"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink kind="secondary" chrome href="/login">
            {NAV.logIn}
          </ButtonLink>
          <OpenRumiButton kind="secondary" chrome className="hidden lg:inline-flex" />
          <MenuSheet />
        </div>
      </div>
    </header>
  );
}
