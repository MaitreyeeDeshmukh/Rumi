import Link from "next/link";
import { MAIN_NAV, SITE } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="logo" aria-label={`${SITE.name} home`}>
        <svg width="32" height="32" viewBox="0 0 120 120" aria-hidden="true">
          <path
            d="M61 10c23 0 46 15 47 41 1 28-18 55-48 56-30 1-50-22-48-50 2-27 26-47 49-47Z"
            fill="var(--lav-strong)"
          />
          <rect x="44" y="52" width="7" height="11" rx="3.5" fill="#343345" />
          <rect x="69" y="52" width="7" height="11" rx="3.5" fill="#343345" />
          <path d="M52 74c4 5 12 5 16 0" stroke="#343345" strokeWidth="3.2" strokeLinecap="round" fill="none" />
        </svg>
        <span>{SITE.name}</span>
      </Link>
      <nav aria-label="Main" className="main-nav">
        {MAIN_NAV.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
