import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProd = process.env.NODE_ENV === "production";
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      isProd
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
      "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://files.dyskiof.net",
      "font-src 'self' data:",
      "connect-src 'self' https: wss: https://*.r2.cloudflarestorage.com https://*.ingest.sentry.io https://challenges.cloudflare.com",
      "media-src 'self' blob: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'self' https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
    ].join("; "),
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 24 hours
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    // Detect if we are running inside Docker
    const isDocker = process.env.HOSTNAME === "0.0.0.0" || process.env.API_HOST === "api";
    const defaultApiUrl = isDocker ? "http://api:8080/api" : "http://localhost:8080/api";

    let apiUrl = process.env.API_URL || defaultApiUrl;

    // If we are in Docker but apiUrl points to localhost, fix it for the proxy
    if (isDocker && apiUrl.includes("localhost:8080")) {
      console.log("[next.config] Docker detected, fixing API_URL from localhost to api");
      apiUrl = apiUrl.replace("localhost:8080", "api:8080");
    }

    // Strip trailing /api if present for the destination base
    const apiBase = apiUrl.endsWith("/api") ? apiUrl.slice(0, -4) : apiUrl;

    console.log(`[next.config] Rewriting /api to ${apiBase}/api`);

    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
};

const configWithIntl = withNextIntl(nextConfig);

export default withSentryConfig(configWithIntl, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
