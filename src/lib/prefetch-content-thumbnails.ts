import { contentThumbnailSrc, type ContentThumbnailOptions } from "@/lib/content-thumbnail";

const warmedUrls = new Set<string>();

/**
 * Warm browser cache for a thumbnail URL (same URL as RetryImage hero).
 * Deduped per session so repeated prefetch calls are cheap.
 */
export function prefetchContentThumbnailUrl(url: string): void {
  if (typeof window === "undefined") return;
  if (warmedUrls.has(url)) return;
  warmedUrls.add(url);
  const img = new Image();
  img.src = url;
}

/** Prefetch hero-sized thumbnail for a content item (matches gallery / viewer RetryImage). */
export function prefetchContentHero(
  contentItemId: string,
  thumbnailUrl: string | null | undefined,
  options: ContentThumbnailOptions
): void {
  prefetchContentThumbnailUrl(contentThumbnailSrc(contentItemId, thumbnailUrl, options));
}
