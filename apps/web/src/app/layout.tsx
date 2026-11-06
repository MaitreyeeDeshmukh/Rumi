import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Caveat, Nunito_Sans } from "next/font/google";
import { ClientErrorListener } from "./ClientErrorListener";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { CrisisProvider } from "@/components/CrisisProvider";
import { NavHistoryProvider } from "@/components/nav/NavHistoryProvider";
import { OverlayScrollbar } from "@/components/OverlayScrollbar";
import { NAV } from "@/content/nav";
import { PAGES_COPY } from "@/content/pages";
import { RumiProvider, ThemeSync } from "@/lib/rumiActive";
import { SITE } from "@/lib/site";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"], display: "swap" });
const body = Nunito_Sans({ variable: "--font-body", subsets: ["latin"], display: "swap" });
const hand = Caveat({ variable: "--font-hand", subsets: ["latin"], weight: ["500", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: PAGES_COPY["/"].title, template: `%s | ${SITE.name}` },
  description: SITE.description,
  openGraph: { title: PAGES_COPY["/"].title, description: SITE.description, siteName: SITE.name, type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F1E7" },
    { media: "(prefers-color-scheme: dark)", color: "#17161E" },
  ],
};

/** Fonts, providers and the first-paint script only. The (site) and (app) layouts add their own chrome. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        {/* A plain inline script in the head runs while the page is parsed, so the first paint already has the look. */}
        <script>{THEME_INIT_SCRIPT}</script>
      </head>
      <body>
        {/* A client component inside a server layout is fine: it renders its children at once and only restores an existing session after load. */}
        <AuthProvider>
          <ClientErrorListener />
          <a className="skip-link" href="#main">
            {NAV.skipLink}
          </a>
          <RumiProvider>
            <ThemeSync />
            <NavHistoryProvider>
              <CrisisProvider>{children}</CrisisProvider>
            </NavHistoryProvider>
          </RumiProvider>
          <OverlayScrollbar />
        </AuthProvider>
      </body>
    </html>
  );
}
