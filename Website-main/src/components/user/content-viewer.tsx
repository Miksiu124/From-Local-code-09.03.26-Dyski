"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Heart, ChevronLeft, ChevronRight, Share2, Check } from "lucide-react";
import { VideoPlayer } from "@/components/user/video-player";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ContentViewerProps {
  contentItemId: string;
  contentType: string;
  modelName: string;
  modelSlug: string;
  prevItemId: string | null;
  nextItemId: string | null;
}

export function ContentViewer({
  contentItemId,
  contentType,
  modelName,
  modelSlug,
  prevItemId,
  nextItemId,
}: ContentViewerProps) {
  const router = useRouter();
  const [isFavorited, setIsFavorited] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Cleanup copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // Check if this item is already favorited
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/favorites/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentItemIds: [contentItemId] }),
        });
        if (res.ok) {
          const data = await res.json();
          setIsFavorited(data.favorited.includes(contentItemId));
        }
      } catch {
        // Ignore
      }
    })();
  }, [contentItemId]);

  const toggleFavorite = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentItemId }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsFavorited(data.favorited);
      }
    } finally {
      setToggling(false);
    }
  };

  const handleShare = useCallback(async () => {
    const url = window.location.href;
    const showCopied = () => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    };
    try {
      await navigator.clipboard.writeText(url);
      showCopied();
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      showCopied();
    }
  }, []);

  const goToPrev = useCallback(() => {
    if (prevItemId) router.push(`/content/${modelSlug}/${prevItemId}`);
  }, [prevItemId, modelSlug, router]);

  const goToNext = useCallback(() => {
    if (nextItemId) router.push(`/content/${modelSlug}/${nextItemId}`);
  }, [nextItemId, modelSlug, router]);

  // Keyboard navigation (ArrowLeft / ArrowRight for photos, not videos -- video player handles its own keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if video player or input is focused
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // For videos, only handle Shift+Arrow (so plain arrows still work for seeking)
      if (contentType === "VIDEO") {
        if (e.key === "ArrowLeft" && e.shiftKey) {
          e.preventDefault();
          goToPrev();
        } else if (e.key === "ArrowRight" && e.shiftKey) {
          e.preventDefault();
          goToNext();
        }
      } else {
        // For photos, plain arrow keys navigate
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goToPrev();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          goToNext();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [contentType, goToPrev, goToNext]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between mb-6">
        <Link
          href={`/models/${modelSlug}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {modelName}
        </Link>

        <div className="flex items-center gap-2">
          {/* Prev / Next buttons */}
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrev}
            disabled={!prevItemId}
            className="h-8 w-8"
            title={contentType === "VIDEO" ? "Previous (Shift+Left)" : "Previous (Left Arrow)"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNext}
            disabled={!nextItemId}
            className="h-8 w-8"
            title={contentType === "VIDEO" ? "Next (Shift+Right)" : "Next (Right Arrow)"}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFavorite}
            disabled={toggling}
            className="gap-1.5"
          >
            <Heart
              className={cn(
                "h-4 w-4 transition-colors",
                isFavorited ? "fill-red-500 text-red-500" : "text-muted-foreground"
              )}
            />
            {isFavorited ? "Favorited" : "Favorite"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleShare}
            className="gap-1.5"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Share2 className="h-4 w-4 text-muted-foreground" />
            )}
            {copied ? "Copied!" : "Share"}
          </Button>
        </div>
      </div>

      <div className="relative rounded-xl overflow-hidden bg-black flex items-center justify-center">
        {contentType === "VIDEO" ? (
          <div className="w-full max-w-6xl">
            <VideoPlayer contentItemId={contentItemId} />
          </div>
        ) : (
          <img
            src={`/api/content/${contentItemId}/thumbnail`}
            alt=""
            className="max-h-[85vh] max-w-full w-auto mx-auto object-contain"
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
          />
        )}
      </div>

      {/* Navigation hint */}
      <p className="text-center text-xs text-muted-foreground mt-3">
        {contentType === "VIDEO"
          ? "Shift + Arrow keys to navigate between items"
          : "Arrow keys to navigate between items"}
      </p>
    </motion.div>
  );
}
