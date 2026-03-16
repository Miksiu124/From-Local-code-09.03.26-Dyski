"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import { RetryImage } from "./retry-image";
import { cn } from "@/lib/utils";

const CDN_HOST = "files.dyskiof.net";

function isCdnUrl(src: string): boolean {
  try {
    return new URL(src, "https://dummy").hostname === CDN_HOST;
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
 * Uses next/image for CDN URLs (optimization, WebP/AVIF) with fallback to RetryImage on error.
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

  // CDN URL: use next/image for optimization
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
        unoptimized={false}
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
      unoptimized={false}
    />
  );
}
