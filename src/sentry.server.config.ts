/**
 * Sentry server-side (Node.js) configuration.
 * DSN is server-only — never exposed to client.
 */

import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

const dsn = process.env.SENTRY_DSN;
const isProd = process.env.NODE_ENV === "production";

Sentry.init({
  dsn: dsn || undefined,
  enabled: !!dsn,

  environment: isProd ? "production" : "development",
  tracesSampleRate: isProd ? 0.2 : 1.0,

  // Privacy: do not send IP, cookies, or other PII by default
  sendDefaultPii: false,

  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});
