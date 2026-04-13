/**
 * Prefer CDN thumbnail URL from API when safe (https); else same-origin proxy.
 * For hosts in NEXT_PUBLIC_MEDIA_HOST, appends ?w= (and ?q=) so the files worker can resize.
 * If CDN 404s, pass the same id to {@link contentThumbnailProxySrc} as RetryImage `fallbackSrc`.
 */

const CDN_HOSTS = (process.env.NEXT_PUBLIC_MEDIA_HOST || "files.dyskiof.net")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export interface ContentThumbnailOptions {
  /** Max width sent as ?w= on CDN URLs (1–2048). Ignored for /api proxy. */
  cdnMaxWidth?: number;
  /** JPEG/WebP quality 1–100 for ?q=; default 75. */
  quality?: number;
}

function isMediaCdnHttpsUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return false;
    return CDN_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function appendCdnResizeParams(
  urlStr: string,
  cdnMaxWidth: number,
  quality?: number
): string {
  const u = new URL(urlStr);
  const w = Math.min(Math.max(1, Math.round(cdnMaxWidth)), 2048);
  u.searchParams.set("w", String(w));
  const q = quality ?? 75;
  if (q >= 1 && q <= 100) u.searchParams.set("q", String(q));
  return u.href;
}

export function contentThumbnailProxySrc(contentItemId: string): string {
  return `/api/content/${contentItemId}/thumbnail`;
}

/** Default ?w= when a CDN thumb URL has no explicit width (grid-style cells). */
const DEFAULT_CDN_THUMB_WIDTH = 640;

export function contentThumbnailSrc(
  contentItemId: string,
  thumbnailUrl?: string | null,
  options?: ContentThumbnailOptions
): string {
  if (
    typeof thumbnailUrl === "string" &&
    thumbnailUrl.length > 0 &&
    /^https:\/\//i.test(thumbnailUrl)
  ) {
    if (isMediaCdnHttpsUrl(thumbnailUrl)) {
      const w = options?.cdnMaxWidth ?? DEFAULT_CDN_THUMB_WIDTH;
      return appendCdnResizeParams(thumbnailUrl, w, options?.quality);
    }
    return thumbnailUrl;
  }
  return contentThumbnailProxySrc(contentItemId);
}
