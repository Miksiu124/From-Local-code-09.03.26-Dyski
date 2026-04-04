/**
 * Payload for /api/public/client-errors — structured for storage and DWH-friendly fields.
 */
export function buildClientErrorReport(overrides: {
  message: string;
  stack?: string;
  component?: string;
}) {
  const viewport =
    typeof window !== "undefined"
      ? { w: window.innerWidth, h: window.innerHeight }
      : undefined;
  return {
    message: overrides.message.slice(0, 2000),
    stack: (overrides.stack ?? "").slice(0, 12000),
    path: typeof window !== "undefined" ? window.location.pathname : "",
    component: (overrides.component ?? "").slice(0, 500),
    release: (process.env.NEXT_PUBLIC_APP_RELEASE ?? "").slice(0, 200),
    extra: {
      locale: typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined,
      viewport,
    },
  };
}
