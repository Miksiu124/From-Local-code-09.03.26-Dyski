/**
 * Canonical origin where Next.js serves the app and rewrites `/api/*` to the Go backend.
 *
 * If users open the site on a CDN-only hostname (e.g. cdn.example.com), relative `/api/...`
 * resolves to that host, which often has no API — HLS manifests return 404 JSON.
 * Set NEXT_PUBLIC_APP_URL=https://example.com so browser requests target the real app origin.
 */
export function getNextPublicAppOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
  return raw.replace(/\/+$/, "");
}

/** Absolute URL for a path starting with `/api` (or any path), or relative if no public origin is set. */
export function resolveApiPathForBrowser(path: string): string {
  const origin = getNextPublicAppOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!origin) return p;
  return `${origin}${p}`;
}
