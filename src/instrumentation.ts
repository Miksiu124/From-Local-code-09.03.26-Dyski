/**
 * Next.js Instrumentation Hook
 *
 * Executed once when the Next.js server starts.
 * R2 sync is handled entirely by the Go backend.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  const { validateEnv } = await import("./lib/env-validate");
  validateEnv();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/** Capture errors from Server Components, middleware, and proxies. */
export const onRequestError = Sentry.captureRequestError;
