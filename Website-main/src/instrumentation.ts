/**
 * Next.js Instrumentation Hook
 *
 * This file is executed once when the Next.js server starts.
 * We use it to kick off the background R2 auto-sync loop.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  const { validateEnv } = await import("./lib/env-validate");
  validateEnv();

  // Only run server-side sync on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutoSync } = await import("./lib/r2-auto-sync");
    startAutoSync();
  }
}
