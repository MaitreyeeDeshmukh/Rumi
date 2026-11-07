import Link from "next/link";
import { COPY } from "@/components/copy";
import { NAV } from "@/content/nav";
import { FOOTER_COLUMNS, SITE } from "@/lib/site";

const linkClass = "inline-flex min-h-11 items-center text-ink underline underline-offset-4 hover:text-primary";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="no-print border-t border-line pb-[env(safe-area-inset-bottom)] text-[.95rem] text-muted-ink">
      <div className="mx-auto grid w-full max-w-[var(--main-max)] gap-8 px-[var(--gutter,1rem)] py-8">
        <nav aria-label={NAV.footerLabel} className="grid gap-6 sm:grid-cols-3">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} role="group" aria-labelledby={`footer-${column.title}`}>
              <h2 id={`footer-${column.title}`} className="mt-0 mb-1 text-base font-bold text-ink">
                {column.title}
              </h2>
              <ul className="m-0 grid list-none p-0">
                {column.links
                  .filter((l) => l.href !== "/welcome")
                  .map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className={linkClass}>
                        {l.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-line pt-6 text-center">
          <p className="mb-1 font-bold text-ink">{COPY.notDoctor}</p>
          <p className="m-0 mx-auto">
            &copy; {year} {SITE.name}. {NAV.legal}
          </p>
        </div>
      </div>
    </footer>
  );
}
