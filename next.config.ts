import type { NextConfig } from "next";

const prod = process.env.NODE_ENV === "production";

// A restrictive Content Security Policy for production. Next.js needs inline scripts and styles, so
// 'unsafe-inline' is kept, but nothing can load from another origin, be framed, or submit elsewhere.
// (Development needs eval for hot reload, so the policy applies to production builds only.)
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The PDF renderer must run as a normal Node module on the server, not be bundled.
  // The end-to-end run builds into its own folder so it never overwrites a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@react-pdf/renderer"],
  async headers() {
    return [
      {
        // The service worker must never be served from a stale HTTP cache.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          ...(prod
            ? [
                { key: "Content-Security-Policy", value: csp },
                { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
              ]
            : []),
        ],
      },
    ];
  },
};

export default config;
