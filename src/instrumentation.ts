/**
 * Next.js Instrumentation Hook
 *
 * Executed once when the Next.js server starts.
 * R2 sync is handled entirely by the Go backend.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  const { validateEnv } = await import("./lib/env-validate");
  validateEnv();
}
