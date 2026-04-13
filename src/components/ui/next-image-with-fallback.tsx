"use client";

import { useState, useCallback } from "react";
import Image, { type ImageLoaderProps } from "next/image";
import { RetryImage } from "./retry-image";
import { cn } from "@/lib/utils";

/** Comma-separated hostnames for CDN (`cdnImageLoader` + worker `?w=`). */
const CDN_HOSTS = (process.env.NEXT_PUBLIC_MEDIA_HOST || "files.dyskiof.net")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isCdnUrl(src: string): boolean {
  try {
    const host = new URL(src, "https://dummy").hostname.toLowerCase();
    return CDN_HOSTS.includes(host);
  } catch {
    return false;
  }
}

/** Requests a downscaled width from the CDN Worker (?w=) — Image Resizing at the edge. */
function cdnImageLoader({ src, width, quality }: ImageLoaderProps): string {
  if (!width || width <= 0) return src;
  try {
    const u = new URL(src, "https://files.dyskiof.net");
    u.searchParams.set("w", String(Math.min(width, 2048)));
    const q = quality ?? 75;
    if (q >= 1 && q <= 100) u.searchParams.set("q", String(q));
    return u.href;
  } catch {
    return src;
  }
}

interface NextImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  loading?: "lazy" | "eager";
  priority?: boolean;
  fill?: boolean;
  sizes?: string;
  width?: number;
  height?: number;
  /** Passed to next/image / loader `q` on CDN (default 75). */
  quality?: number;
}

/**
 * CDN: `unoptimized` + `cdnImageLoader` — requests go to the worker with `?w=` / `?q=` (edge resize).
 * `priority` also sets `fetchPriority="high"` for LCP (Lighthouse).
 * Non-CDN (e.g. /api/...): RetryImage.
 */
export function NextImageWithFallback({
  src,
  alt,
  className,
  fallback,
  loading = "lazy",
  priority = false,
  fill = false,
  sizes,
  width,
  height,
  quality = 75,
}: NextImageWithFallbackProps) {
  const [useImgFallback, setUseImgFallback] = useState(false);
  const isCdn = isCdnUrl(src);

  const handleError = useCallback(() => {
    setUseImgFallback(true);
  }, []);

  const fetchPriority = priority ? ("high" as const) : undefined;

  // Non-CDN or error fallback: use RetryImage (handles retries, proxy URLs)
  if (!isCdn || useImgFallback) {
    return (
      <RetryImage
        src={src}
        alt={alt}
        className={fill ? cn("absolute inset-0 w-full h-full", className) : className}
        fallback={fallback}
        loading={loading}
        fetchPriority={fetchPriority}
      />
    );
  }

  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        className={className}
        sizes={sizes}
        quality={quality}
        loader={cdnImageLoader}
        loading={priority ? undefined : loading}
        priority={priority}
        fetchPriority={fetchPriority}
        onError={handleError}
        unoptimized
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width ?? 400}
      height={height ?? 533}
      className={className}
      sizes={sizes}
      quality={quality}
      loader={cdnImageLoader}
      loading={priority ? undefined : loading}
      priority={priority}
      fetchPriority={fetchPriority}
      onError={handleError}
      unoptimized
    />
  );
}
