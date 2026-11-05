import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Nunito_Sans } from "next/font/google";
import Script from "next/script";
import { AppNav, OutsideApp } from "@/components/AppNav";
import { CrisisProvider } from "@/components/CrisisProvider";
import { RumiProvider } from "@/components/deps";
import { ThemeSync } from "@/components/ThemeSync";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE } from "@/lib/site";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"], display: "swap" });
const body = Nunito_Sans({ variable: "--font-body", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: `${SITE.name}: your world, your pace, your way`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  openGraph: { title: SITE.name, description: SITE.description, type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F7F4" },
    { media: "(prefers-color-scheme: dark)", color: "#17161E" },
  ],
};

/** Runs before paint so the saved theme, motion and text size apply with no flash. Reads only local settings. */
const THEME_SCRIPT = `try{var s=(JSON.parse(localStorage.getItem('rumi.v1')||'{}').settings)||{};var h=document.documentElement;h.dataset.appTheme=s.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'low':'soft');h.dataset.reducedMotion=String(!!s.reducedMotion||matchMedia('(prefers-reduced-motion: reduce)').matches);h.style.setProperty('--scale',s.textScale||1)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body>
        <Script id="rumi-theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        <RumiProvider>
          <CrisisProvider>
            <ThemeSync />
            <a className="skip-link" href="#main">
              Skip to main content
            </a>
            <SiteHeader />
            <main id="main" tabIndex={-1}>
              {children}
            </main>
            <AppNav />
            <OutsideApp>
              <SiteFooter />
            </OutsideApp>
          </CrisisProvider>
        </RumiProvider>
      </body>
    </html>
  );
}
