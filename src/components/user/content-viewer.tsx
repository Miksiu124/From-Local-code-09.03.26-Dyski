"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Heart, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { contentThumbnailSrc, contentThumbnailProxySrc } from "@/lib/content-thumbnail";
import { prefetchContentHero } from "@/lib/prefetch-content-thumbnails";
import { RetryImage } from "@/components/ui/retry-image";
import { trackContentDetailView, trackPhotoViewFirst } from "@/lib/growth-analytics";

const VideoPlayer = dynamic(
  () => import("@/components/user/video-player").then((m) => ({ default: m.VideoPlayer })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

interface ContentViewerProps {
  contentItemId: string;
  contentType: string;
  modelName: string;
  modelSlug: string;
  /** Opcjonalnie — video_engagement w analytics */
  modelId?: string;
  prevItemId: string | null;
  nextItemId: string | null;
  /** CDN thumbnail from API when R2_PUBLIC_URL is set */
  thumbnailUrl?: string | null;
  /** Original MP4 in R2 (source_video_path) — show download in player */
  hasSourceMp4?: boolean;
  backHref?: string;
  backLabel?: string;
  navBasePath?: string;
  detailsApiPath?: string;
  searchParamsForNav?: string;
}

interface DisplayedState {
  contentItemId: string;
  contentType: string;
  modelName: string;
  prevItemId: string | null;
  nextItemId: string | null;
  thumbnailUrl?: string | null;
  hasSourceMp4?: boolean;
}

export function ContentViewer({
  contentItemId,
  contentType,
  modelName,
  modelSlug,
  modelId,
  prevItemId,
  nextItemId,
  thumbnailUrl: initialThumbnailUrl,
  hasSourceMp4: initialHasSourceMp4,
  backHref: backHrefProp,
  backLabel,
  navBasePath,
  detailsApiPath,
  searchParamsForNav,
}: ContentViewerProps) {
  const t = useTranslations("models");
  const router = useRouter();
  const [isFavorited, setIsFavorited] = useState(false);
  const [toggling, setToggling] = useState(false);

  // In fullscreen: in-place nav keeps VideoPlayer mounted (no fullscreen exit on Android)
  const [displayedState, setDisplayedState] = useState<DisplayedState | null>(null);

  const [computedBackHref, setComputedBackHref] = useState(`/models/${modelSlug}`);
  useEffect(() => {
    if (backHrefProp) return;
    if (typeof window === "undefined") return;
    const filter = sessionStorage.getItem(`filter_model_${modelSlug}`);
    const sort = sessionStorage.getItem(`sort_model_${modelSlug}`);
    const params = new URLSearchParams();
    const validFilters = ["ALL", "VIDEO", "PHOTO", "FAVORITES"];
    const validSorts = ["newest", "oldest", "longest", "shortest"];
    if (filter && filter !== "ALL" && validFilters.includes(filter)) params.set("filter", filter);
    if (sort && sort !== "newest" && validSorts.includes(sort)) params.set("sort", sort);
    const qs = params.toString();
    setComputedBackHref(`/models/${modelSlug}${qs ? `?${qs}` : ""}`);
  }, [modelSlug, backHrefProp]);

  const backHref = backHrefProp ?? computedBackHref;
  const f5RedirectCheckedRef = useRef(false);

  // F5 fallback: when user refreshes on content page (video player), redirect to model folder.
  // Run only once on mount — ContentViewer is a different route so no "click adds view" case.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (f5RedirectCheckedRef.current) return;
    f5RedirectCheckedRef.current = true;
    const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type !== "reload") return;
    const filter = sessionStorage.getItem(`filter_model_${modelSlug}`);
    const sort = sessionStorage.getItem(`sort_model_${modelSlug}`);
    const params = new URLSearchParams();
    const validFilters = ["ALL", "VIDEO", "PHOTO", "FAVORITES"];
    const validSorts = ["newest", "oldest", "longest", "shortest"];
    if (filter && filter !== "ALL" && validFilters.includes(filter)) params.set("filter", filter);
    if (sort && sort !== "newest" && validSorts.includes(sort)) params.set("sort", sort);
    const qs = params.toString();
    router.replace(`/models/${modelSlug}${qs ? `?${qs}` : ""}`);
  }, [modelSlug, router]);

  const handleBack = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    router.push(backHref);
    if (backHref.startsWith("/models/")) {
      const savedY = typeof window !== "undefined" ? sessionStorage.getItem(`scroll_model_${modelSlug}`) : null;
      if (savedY) {
        const y = parseInt(savedY, 10);
        if (!Number.isNaN(y) && y >= 0) {
          requestAnimationFrame(() => {
            setTimeout(() => window.scrollTo({ top: y, behavior: "instant" }), 50);
          });
        }
      }
    }
  }, [backHref, modelSlug, router]);

  const effectiveItemId = displayedState?.contentItemId ?? contentItemId;
  const effectiveContentType = displayedState?.contentType ?? contentType;
  const effectivePrevId = displayedState?.prevItemId ?? prevItemId;
  const effectiveNextId = displayedState?.nextItemId ?? nextItemId;
  const effectiveThumbUrl =
    displayedState?.thumbnailUrl ?? initialThumbnailUrl ?? null;
  const effectiveHasSourceMp4 =
    displayedState?.hasSourceMp4 ?? initialHasSourceMp4 ?? false;

  useEffect(() => {
    const surface =
      navBasePath === "/favorites" ? "favorites_page" : "content_page";
    trackContentDetailView(effectiveItemId, {
      surface,
      content_type: effectiveContentType,
      model_id: modelId,
      folder_name: modelSlug,
    });
  }, [effectiveItemId, effectiveContentType, modelId, modelSlug, navBasePath]);

  const GF_PHOTO_FIRST_KEY = "gf_photo_first_ids";
  useEffect(() => {
    if (effectiveContentType !== "PHOTO") return;
    try {
      const raw = sessionStorage.getItem(GF_PHOTO_FIRST_KEY);
      const arr: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      if (arr.includes(effectiveItemId)) return;
      sessionStorage.setItem(GF_PHOTO_FIRST_KEY, JSON.stringify([...arr, effectiveItemId]));
      trackPhotoViewFirst(effectiveItemId, { model_slug: modelSlug });
    } catch {
      trackPhotoViewFirst(effectiveItemId, { model_slug: modelSlug });
    }
  }, [effectiveContentType, effectiveItemId, modelSlug]);

  useEffect(() => {
    if (effectiveContentType !== "PHOTO") return;
    const opts = { cdnMaxWidth: 1280, quality: 80 } as const;
    if (effectivePrevId) prefetchContentHero(effectivePrevId, null, opts);
    if (effectiveNextId) prefetchContentHero(effectiveNextId, null, opts);
  }, [effectiveContentType, effectivePrevId, effectiveNextId]);

  useEffect(() => {
    if (displayedState) setDisplayedState(null);
  }, [contentItemId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/favorites/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ contentItemIds: [effectiveItemId] }),
        });
        if (res.ok) {
          const data = await res.json();
          setIsFavorited(data.favorited.includes(effectiveItemId));
        }
      } catch {
        // Silently ignore
      }
    })();
  }, [effectiveItemId]);

  const toggleFavorite = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contentItemId: effectiveItemId }),
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

  const navigateInPlace = useCallback(
    async (targetItemId: string) => {
      if (contentType !== "VIDEO") return;
      const apiPath = detailsApiPath ?? `/api/content/${modelSlug}`;
      const navPath = navBasePath ?? `/content/${modelSlug}`;
      const qs = searchParamsForNav ?? "";
      const targetUrl = `${navPath}/${targetItemId}${qs}`;
      try {
        const res = await fetch(`${apiPath}/${targetItemId}/details${qs}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.hasAccess) return;
        setDisplayedState({
          contentItemId: data.contentItem.id,
          contentType: data.contentItem.contentType,
          modelName: data.model.name,
          prevItemId: data.prevItemId,
          nextItemId: data.nextItemId,
          thumbnailUrl: data.contentItem.thumbnailUrl ?? null,
          hasSourceMp4: data.contentItem.hasSourceMp4 === true,
        });
        router.replace(targetUrl);
      } catch {
        router.push(targetUrl);
      }
    },
    [contentType, modelSlug, router, detailsApiPath, navBasePath, searchParamsForNav]
  );

  const buildNavUrl = useCallback(
    (targetId: string) => {
      if (navBasePath) {
        const qs = searchParamsForNav ?? "";
        return `${navBasePath}/${targetId}${qs}`;
      }
      return `/content/${modelSlug}/${targetId}`;
    },
    [navBasePath, modelSlug, searchParamsForNav]
  );

  const goToPrev = useCallback(() => {
    const targetId = effectivePrevId;
    if (!targetId) return;
    const doc = document as Document & { webkitFullscreenElement?: Element };
    const isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (isFullscreen && contentType === "VIDEO") {
      navigateInPlace(targetId);
    } else {
      router.push(buildNavUrl(targetId));
    }
  }, [effectivePrevId, router, contentType, navigateInPlace, buildNavUrl]);

  const goToNext = useCallback(() => {
    const targetId = effectiveNextId;
    if (!targetId) return;
    const doc = document as Document & { webkitFullscreenElement?: Element };
    const isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (isFullscreen && contentType === "VIDEO") {
      navigateInPlace(targetId);
    } else {
      router.push(buildNavUrl(targetId));
    }
  }, [effectiveNextId, router, contentType, navigateInPlace, buildNavUrl]);

  // ── Mobile swipe navigation ──────────────────────────────────
  const touchStartXRef = useRef<number | null>(null);
  const touchStartTimeRef = useRef<number | null>(null);
  const touchStartTargetRef = useRef<HTMLElement | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
    touchStartTimeRef.current = Date.now();
    touchStartTargetRef.current = e.target as HTMLElement;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartTimeRef.current === null) return;
    const target = touchStartTargetRef.current;
    const touchedControls = target?.closest?.("[data-controls]");
    const doc = document as Document & { webkitFullscreenElement?: Element };
    const isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement);

    // Pomiń swipe tylko gdy touch na controls (progress bar, play, seek) — wtedy user używa player
    if (touchedControls) {
      touchStartXRef.current = null;
      touchStartTimeRef.current = null;
      touchStartTargetRef.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const dt = Date.now() - touchStartTimeRef.current;
    touchStartXRef.current = null;
    touchStartTimeRef.current = null;
    touchStartTargetRef.current = null;
    const THRESHOLD = 90;
    const MIN_DURATION_MS = 50;
    const MIN_VELOCITY = 0.2;
    if (dt < MIN_DURATION_MS) return;
    const velocity = Math.abs(dx) / dt;
    if (Math.abs(dx) < THRESHOLD) return;
    if (velocity < MIN_VELOCITY && Math.abs(dx) < 120) return;
    if (dx < -THRESHOLD) {
      e.preventDefault();
      goToNext();
    } else if (dx > THRESHOLD) {
      e.preventDefault();
      goToPrev();
    }
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
      className="overflow-x-hidden min-w-0"
    >
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-2">
        <a
          href={backHref}
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{backLabel ?? t("backToModel", { modelName })}</span>
          <span className="sm:hidden">Back</span>
        </a>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={goToPrev}
            disabled={!effectivePrevId}
            className="h-8 w-8 rounded-lg"
            title={contentType === "VIDEO" ? "Previous (Shift+Left)" : "Previous (Left Arrow)"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goToNext}
            disabled={!effectiveNextId}
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
                isFavorited ? "fill-primary text-primary scale-110" : "text-muted-foreground"
              )}
            />
            <span className="hidden sm:inline">{isFavorited ? t("favorited") : t("favorite")}</span>
          </Button>
        </div>
      </div>

      <div
        className="relative rounded-xl sm:rounded-2xl overflow-hidden bg-black flex items-center justify-center touch-pan-y min-w-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {effectiveContentType === "VIDEO" ? (
          <div className="w-full max-w-6xl min-w-0 shrink">
            <VideoPlayer
              contentItemId={effectiveItemId}
              modelId={modelId}
              folderName={modelSlug}
              hasSourceMp4={effectiveHasSourceMp4}
            />
          </div>
        ) : (
          <RetryImage
            src={contentThumbnailSrc(effectiveItemId, effectiveThumbUrl, {
              cdnMaxWidth: 1280,
              quality: 80,
            })}
            fallbackSrc={contentThumbnailProxySrc(effectiveItemId)}
            alt={effectiveContentType === "VIDEO" ? t("video") : t("photo")}
            className="max-h-[85vh] max-w-full w-auto object-contain"
            holdPreviousUntilLoaded
            loading="eager"
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
          />
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground/50 mt-3">
        <span className="hidden sm:inline">
          {contentType === "VIDEO" ? t("shiftArrowsToNavigate") : t("arrowsToNavigate")}
        </span>
        <span className="sm:hidden">{t("swipeToNavigate")}</span>
      </p>
    </motion.div>
  );
}
