import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content-Security-Policy is set per-request in src/middleware.ts so that
// each response gets a fresh nonce (instead of relying on 'unsafe-inline').
// Everything else is static and lives here.
const securityHeaders = [
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
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), gyroscope=(), magnetometer=(), accelerometer=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Smaller client bundles: lucide barrel imports → per-icon modules (tree-shaking).
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "files.dyskiof.net",
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

export default withNextIntl(nextConfig);
