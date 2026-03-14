"use client";

import { useState, useRef, useEffect } from "react";
import { RetryImage } from "./retry-image";

interface LazyRetryImageProps extends Omit<React.ComponentProps<typeof RetryImage>, "src"> {
  src: string;
  /** Pixels before viewport to start loading. Larger = load earlier, fewer misses on fast scroll. */
  rootMargin?: string;
  /** Placeholder shown before image enters load zone. Keeps layout stable. */
  placeholder?: React.ReactNode;
}

/**
 * RetryImage with custom IntersectionObserver-based lazy loading.
 * Uses a generous rootMargin so images start loading before they enter the viewport,
 * reducing "blank thumbnails" when scrolling fast (browser native lazy loading can miss
 * elements or abort requests during rapid scroll).
 */
export function LazyRetryImage({
  src,
  alt,
  rootMargin = "600px",
  placeholder,
  className,
  ...props
}: LazyRetryImageProps) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShouldLoad(true);
        }
      },
      { rootMargin, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {shouldLoad ? (
        <RetryImage src={src} alt={alt} className={className} loading="eager" {...props} />
      ) : placeholder ?? (
        <div className="absolute inset-0 bg-muted/20 animate-pulse" aria-hidden />
      )}
    </div>
  );
}
