import type { NextConfig } from "next";
import { buildCsp } from "./src/lib/security/csp";

const isDev = process.env.NODE_ENV !== "production";

// Static CSP (no nonces) keeps pages cacheable. Tighten to nonce-based once pages render dynamically.
const csp = buildCsp({ isDev, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL });

// The static preview loads Google Fonts; allow only that extra, and only on /preview.
const previewCsp = csp
  .replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com")
  .replace("font-src 'self' data:", "font-src 'self' data: https://fonts.gstatic.com");

const baseHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Parallel test runs set NEXT_DIST_DIR so their builds do not overwrite each other. Default stays .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/preview/:path*", headers: [...baseHeaders, { key: "Content-Security-Policy", value: previewCsp }] },
      {
        source: "/((?!preview).*)",
        headers: [...baseHeaders, { key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default nextConfig;
