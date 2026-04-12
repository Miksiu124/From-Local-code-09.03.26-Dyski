/**
 * Canonical origin where Next.js serves the app and rewrites `/api/*` to the Go backend.
 *
 * If users open the site on a CDN-only hostname (e.g. cdn.example.com), relative `/api/...`
 * resolves to that host, which often has no API — set NEXT_PUBLIC_APP_URL to the main domain.
 *
 * Docker builds often bake NEXT_PUBLIC_APP_URL=http://localhost — the browser would then
 * request http://localhost/... for HLS. getEffectiveAppOrigin() falls back to window.location.origin
 * when the env value is empty or clearly local, so production works even if build args were wrong.
 */
export function getNextPublicAppOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
  return raw.replace(/\/+$/, "");
}

/** True if the origin looks like local dev (or unset). */
function isLocalDevOrigin(origin: string): boolean {
  const o = origin.replace(/\/+$/, "");
  if (o === "") return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o);
}

/**
 * Origin to use for browser /api calls (HLS playlist, credentials).
 * Prefer NEXT_PUBLIC_APP_URL when it is a real public URL; if it is localhost (typical Docker
 * build default) but the user opened the site on a real domain, use that domain instead.
 */
export function getEffectiveAppOrigin(): string {
  const env = getNextPublicAppOrigin();
  if (typeof window === "undefined") {
    return env;
  }
  const loc = window.location.origin.replace(/\/+$/, "");
  if (isLocalDevOrigin(env) && loc && !isLocalDevOrigin(loc)) {
    return loc;
  }
  return env;
}

/** Absolute URL for a path starting with `/api` (or any path), or relative if no usable origin. */
export function resolveApiPathForBrowser(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") {
    const o = getNextPublicAppOrigin();
    return o ? `${o.replace(/\/+$/, "")}${p}` : p;
  }
  const origin = getEffectiveAppOrigin();
  if (!origin) return p;
  return `${origin.replace(/\/+$/, "")}${p}`;
}
