/**
 * Sentry client-side initialization.
 * Uses tunnel to route events through our server — avoids ad-blockers,
 * keeps traffic on our domain, and allows server-side scrubbing.
 *
 * DSN: Use NEXT_PUBLIC_SENTRY_DSN for client. Omit to disable client-side
 * Sentry (server-only mode). DSN is write-only by design.
 */

import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isProd = process.env.NODE_ENV === "production";

Sentry.init({
  dsn: dsn || undefined,
  enabled: !!dsn,

  // Tunnel is injected by withSentryConfig(tunnelRoute: "/monitoring") in next.config.
  // Events go to /monitoring on our domain, then proxy to Sentry.

  environment: isProd ? "production" : "development",
  tracesSampleRate: isProd ? 0.2 : 1.0,

  // Privacy: no IP, cookies, or other PII
  sendDefaultPii: false,

  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
