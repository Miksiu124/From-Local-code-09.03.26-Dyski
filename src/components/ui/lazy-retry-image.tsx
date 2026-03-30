"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { RetryImage } from "./retry-image";

interface LazyRetryImageProps extends Omit<React.ComponentProps<typeof RetryImage>, "src"> {
  src: string;
  /** Pixels before viewport to start loading. Larger = load earlier, fewer misses on fast scroll. */
  rootMargin?: string;
  /** Placeholder shown before image enters load zone. Keeps layout stable. */
  placeholder?: React.ReactNode;
  /** Prioritize loading (above-fold items) — uses fetchPriority="high" */
  priority?: boolean;
}

/**
 * RetryImage with custom IntersectionObserver-based lazy loading.
 * Uses a generous rootMargin so images start loading before they enter the viewport,
 * reducing "blank thumbnails" when scrolling fast (browser native lazy loading can miss
 * elements or abort requests during rapid scroll).
 *
 * Includes a fallback check: when viewport changes (e.g. dev tools open) or during fast scroll,
 * IntersectionObserver may not fire. We periodically check if the element is in view and load.
 */
export function LazyRetryImage({
  src,
  alt,
  rootMargin = "600px",
  placeholder,
  priority = false,
  className,
  ...props
}: LazyRetryImageProps) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const tryLoad = useCallback(() => {
    setShouldLoad((prev) => {
      if (prev) return prev;
      const el = containerRef.current;
      if (!el) return prev;
      const rect = el.getBoundingClientRect();
      const margin = parseInt(String(rootMargin), 10) || 600;
      const inView =
        rect.top < window.innerHeight + margin &&
        rect.bottom > -margin &&
        rect.left < window.innerWidth + margin &&
        rect.right > -margin;
      return inView || prev;
    });
  }, [rootMargin]);

  // After infinite scroll / grid reflow, layout can complete after IO's first pass — recover before paint.
  useLayoutEffect(() => {
    tryLoad();
  }, [tryLoad, src]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e?.isIntersecting) {
          setShouldLoad(true);
        } else {
          // IO false-negative (fast scroll, sub-pixel, containment): rect check still loads when in extended band.
          tryLoad();
        }
      },
      { root: null, rootMargin, threshold: [0, 0.01, 0.25, 0.5, 1] }
    );
    observer.observe(el);

    const ro = new ResizeObserver(() => tryLoad());
    ro.observe(el);

    // Initial check: above-fold items may not trigger IO immediately; run once after layout
    const raf = requestAnimationFrame(() => tryLoad());

    // Fallback: viewport resize (e.g. dev tools open) can cause IO to miss elements.
    const resizeHandler = () => tryLoad();
    window.addEventListener("resize", resizeHandler);

    // Fallback: fast scroll can miss IO callbacks; throttle scroll check
    let scrollTicking = false;
    const scrollHandler = () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        tryLoad();
      });
    };
    window.addEventListener("scroll", scrollHandler, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", resizeHandler);
      window.removeEventListener("scroll", scrollHandler);
    };
  }, [rootMargin, tryLoad]);

  return (
    <div ref={containerRef} className="absolute inset-0 min-h-0 min-w-0">
      {shouldLoad ? (
        <RetryImage
          src={src}
          alt={alt}
          className={className}
          loading="eager"
          fetchPriority={priority ? "high" : undefined}
          {...props}
        />
      ) : placeholder ?? (
        <div className="absolute inset-0 bg-gradient-to-br from-muted/50 via-muted/30 to-secondary/40 animate-pulse" aria-hidden />
      )}
    </div>
  );
}
