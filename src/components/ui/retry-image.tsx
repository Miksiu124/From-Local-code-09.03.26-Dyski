"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface RetryImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  fallback?: React.ReactNode;
  /** After retries on `src` fail, load this URL once (e.g. CDN → same-origin proxy). */
  fallbackSrc?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Image component that retries loading on error before showing fallback.
 * Helps with intermittent thumbnail load failures (connection limits, timeouts).
 */
export function RetryImage({
  src,
  alt,
  className,
  fallback,
  fallbackSrc,
  maxRetries = 2,
  retryDelayMs = 400,
  onError,
  loading,
  ...props
}: RetryImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [retryCount, setRetryCount] = useState(0);
  const [showFallback, setShowFallback] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCurrentSrc(src);
    setRetryCount(0);
    setShowFallback(false);
  }, [src]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      onError?.(e);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (retryCount < maxRetries) {
        timeoutRef.current = setTimeout(() => {
          setRetryCount((c) => c + 1);
          timeoutRef.current = null;
        }, retryDelayMs * (retryCount + 1));
        return;
      }
      if (fallbackSrc && currentSrc !== fallbackSrc) {
        setCurrentSrc(fallbackSrc);
        setRetryCount(0);
        return;
      }
      setShowFallback(true);
    },
    [retryCount, maxRetries, retryDelayMs, onError, fallbackSrc, currentSrc]
  );

  if (showFallback) {
    return <>{fallback ?? <span className="inline-block w-12 h-12 bg-muted/50 rounded" aria-hidden />}</>;
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      onError={handleError}
      key={`${currentSrc}-${retryCount}`}
      loading={loading ?? "lazy"}
      decoding="async"
      {...props}
    />
  );
}
