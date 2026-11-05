import Link from "next/link";
import { FOOTER_NAV, SITE } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <nav aria-label="Footer">
        <ul>
          {FOOTER_NAV.map((l) => (
            <li key={l.href + l.label}>
              {l.href.startsWith("/preview") ? (
                <a href={l.href}>{l.label}</a>
              ) : (
                <Link href={l.href}>{l.label}</Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <p>
        In immediate danger? Call <a href="tel:911">911</a>. For crisis support in the US, call or text{" "}
        <a href="tel:988">988</a>.
      </p>
      <p>
        &copy; {year} {SITE.name}. Rumi is not medical advice and cannot contact emergency services.
      </p>
    </footer>
  );
}
