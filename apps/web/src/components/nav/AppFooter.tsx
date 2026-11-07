import Link from "next/link";
import { NAV } from "@/content/nav";
import { INFO_LINKS } from "@/lib/site";

/** The information pages at the end of every app screen, on phones only: from 1024 px they live in the sidebar's Help and info dropdown. */
export function AppFooter() {
  return (
    <footer className="no-print mt-8 border-t border-line pt-3 lg:hidden">
      <nav aria-label={NAV.helpAndInfo}>
        <ul className="m-0 flex list-none flex-wrap gap-x-4 p-0">
          {INFO_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="inline-flex min-h-11 items-center text-ink underline underline-offset-4 hover:text-primary">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
