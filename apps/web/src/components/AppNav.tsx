'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { COPY } from './copy';
import { Icon, type IconName } from './ui';

const TABS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: '/home', label: COPY.nav.home, icon: 'home' },
  { href: '/get-ready', label: COPY.nav.getReady, icon: 'notes' },
  { href: '/practice', label: COPY.nav.practice, icon: 'chat' },
  { href: '/remember', label: COPY.nav.remember, icon: 'list' },
  { href: '/settings', label: COPY.nav.settings, icon: 'sliders' },
];
const SHOW_ON = new Set([...TABS.map((t) => t.href), '/share', '/kit', '/say-it']);

/** Bottom tab bar. Only on app screens, never on /welcome or the marketing pages. */
export function AppNav() {
  const path = usePathname();
  if (!SHOW_ON.has(path)) return null;
  return (
    <nav aria-label={COPY.nav.label} className="app-nav">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? 'page' : undefined}>
          <span className="tab-ic"><Icon name={t.icon} /></span>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
