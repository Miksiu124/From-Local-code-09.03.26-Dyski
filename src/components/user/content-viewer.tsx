"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Heart, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("models");
  const router = useRouter();
  const [isFavorited, setIsFavorited] = useState(false);
  const [toggling, setToggling] = useState(false);


  const [backHref, setBackHref] = useState(`/models/${modelSlug}`);
  useEffect(() => {
    const filter = sessionStorage.getItem(`filter_model_${modelSlug}`);
    const sort = sessionStorage.getItem(`sort_model_${modelSlug}`);
    const params = new URLSearchParams();
    const validFilters = ["ALL", "VIDEO", "PHOTO", "FAVORITES"];
    const validSorts = ["newest", "oldest", "longest", "shortest"];
    if (filter && filter !== "ALL" && validFilters.includes(filter)) params.set("filter", filter);
    if (sort && sort !== "newest" && validSorts.includes(sort)) params.set("sort", sort);
    const qs = params.toString();
    setBackHref(`/models/${modelSlug}${qs ? `?${qs}` : ""}`);
  }, [modelSlug]);

  const handleBack = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const savedY = sessionStorage.getItem(`scroll_model_${modelSlug}`);
    router.push(backHref);
    if (savedY) {
      const y = parseInt(savedY, 10);
      if (!Number.isNaN(y) && y >= 0) {
        requestAnimationFrame(() => {
          setTimeout(() => window.scrollTo({ top: y, behavior: "instant" }), 50);
        });
      }
    }
  }, [backHref, modelSlug, router]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/favorites/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ contentItemIds: [contentItemId] }),
        });
        if (res.ok) {
          const data = await res.json();
          setIsFavorited(data.favorited.includes(contentItemId));
        }
      } catch {
        // Silently ignore
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
        credentials: "include",
        body: JSON.stringify({ contentItemId }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsFavorited(data.favorited);
      } else {
        console.error("[Favorites] Toggle failed:", res.status);
      }
    } catch (err) {
      console.error("[Favorites] Toggle error:", err);
    } finally {
      setToggling(false);
    }
  };

  const goToPrev = useCallback(() => {
    if (prevItemId) router.push(`/content/${modelSlug}/${prevItemId}`);
  }, [prevItemId, modelSlug, router]);

  const goToNext = useCallback(() => {
    if (nextItemId) router.push(`/content/${modelSlug}/${nextItemId}`);
  }, [nextItemId, modelSlug, router]);

  // ── Mobile swipe navigation ──────────────────────────────────
  const touchStartXRef = useRef<number | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    touchStartXRef.current = null;
    const THRESHOLD = 50;
    if (dx < -THRESHOLD) goToNext();
    else if (dx > THRESHOLD) goToPrev();
  }, [goToNext, goToPrev]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (contentType === "VIDEO") {
        if (e.key === "ArrowLeft" && e.shiftKey) {
          e.preventDefault();
          goToPrev();
        } else if (e.key === "ArrowRight" && e.shiftKey) {
          e.preventDefault();
          goToNext();
        }
      } else {
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
        <a
          href={backHref}
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("backToModel", { modelName })}</span>
          <span className="sm:hidden">Back</span>
        </a>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrev}
            disabled={!prevItemId}
            className="h-8 w-8 rounded-lg"
            title={contentType === "VIDEO" ? "Previous (Shift+Left)" : "Previous (Left Arrow)"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNext}
            disabled={!nextItemId}
            className="h-8 w-8 rounded-lg"
            title={contentType === "VIDEO" ? "Next (Shift+Right)" : "Next (Right Arrow)"}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <div className="w-px h-5 bg-white/[0.08] mx-1 hidden sm:block" />

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFavorite}
            disabled={toggling}
            className="gap-1.5"
          >
            <Heart
              className={cn(
                "h-4 w-4 transition-all",
                isFavorited ? "fill-red-500 text-red-500 scale-110" : "text-muted-foreground"
              )}
            />
            <span className="hidden sm:inline">{isFavorited ? t("favorited") : t("favorite")}</span>
          </Button>
        </div>
      </div>

      <div
        className="relative rounded-xl sm:rounded-2xl overflow-hidden bg-black flex items-center justify-center"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
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

      <p className="text-center text-[10px] sm:text-xs text-muted-foreground/50 mt-3">
        <span className="hidden sm:inline">
          {contentType === "VIDEO" ? t("shiftArrowsToNavigate") : t("arrowsToNavigate")}
        </span>
        <span className="sm:hidden">Swipe left / right to navigate</span>
      </p>
    </motion.div>
  );
}
