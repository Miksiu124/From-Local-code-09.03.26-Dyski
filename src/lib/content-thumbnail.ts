/**
 * Prefer CDN thumbnail URL from API when safe (https); else same-origin proxy.
 * If CDN 404s, pass the same id to {@link contentThumbnailProxySrc} as RetryImage `fallbackSrc`.
 */
export function contentThumbnailProxySrc(contentItemId: string): string {
  return `/api/content/${contentItemId}/thumbnail`;
}

export function contentThumbnailSrc(
  contentItemId: string,
  thumbnailUrl?: string | null,
): string {
  if (
    typeof thumbnailUrl === "string" &&
    thumbnailUrl.length > 0 &&
    /^https:\/\//i.test(thumbnailUrl)
  ) {
    return thumbnailUrl;
  }
  return contentThumbnailProxySrc(contentItemId);
}
