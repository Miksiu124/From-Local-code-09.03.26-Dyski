"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { RetryImage } from "./retry-image";
import { cn } from "@/lib/utils";

/** Comma-separated hostnames for direct CDN images (unoptimized next/image). */
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
}

/**
 * Uses next/image for CDN URLs. For files.dyskiof.net we use unoptimized=true — images are
 * already WebP from R2, so bypassing _next/image avoids cache misses and 12s+ load times.
 * For non-CDN URLs (e.g. /api/... proxy), uses RetryImage directly.
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
}: NextImageWithFallbackProps) {
  const [useImgFallback, setUseImgFallback] = useState(false);
  const isCdn = isCdnUrl(src);

  const handleError = useCallback(() => {
    setUseImgFallback(true);
  }, []);

  // Non-CDN or error fallback: use RetryImage (handles retries, proxy URLs)
  if (!isCdn || useImgFallback) {
    return (
      <RetryImage
        src={src}
        alt={alt}
        className={fill ? cn("absolute inset-0 w-full h-full", className) : className}
        fallback={fallback}
        loading={loading}
      />
    );
  }

  // CDN URL: unoptimized — fetch directly from CDN, skip _next/image pipeline (avoids MISS, 12s lag)
  if (fill) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        className={className}
        sizes={sizes}
        loading={priority ? undefined : loading}
        priority={priority}
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
      loading={priority ? undefined : loading}
      priority={priority}
      onError={handleError}
      unoptimized
    />
  );
}
