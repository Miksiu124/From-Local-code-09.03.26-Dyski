"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Heart, Play, Image, Loader2, Film, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LazyRetryImage } from "@/components/ui/lazy-retry-image";
import { contentThumbnailSrc, contentThumbnailProxySrc } from "@/lib/content-thumbnail";

interface FavoriteItem {
  id: string;
  contentItemId: string;
  contentType: string;
  thumbnailUrl?: string;
  duration: number | null;
  modelName: string;
  modelSlug: string;
  createdAt: string;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

type ContentFilter = "ALL" | "VIDEO" | "PHOTO";

export function FavoritesGrid() {
  const t = useTranslations("favorites");
  const tNav = useTranslations("nav");
  const router = useRouter();

  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ContentFilter>("ALL");
  const observerRef = useRef<IntersectionObserver | null>(null);

  const fetchFavorites = useCallback(async (cursorVal?: string | null, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (cursorVal) params.set("cursor", cursorVal);

      const res = await fetch(`/api/favorites?${params.toString()}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (append) {
          setItems((prev) => [...prev, ...data.items]);
        } else {
          setItems(data.items);
        }
        setCursor(data.nextCursor);
        setTotalCount(data.totalCount);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const loadMoreRef = useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    if (loadingMore || !cursor) return;
    fetchFavorites(cursor, true);
  };

  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreRef.current();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(() => {
    return () => { observerRef.current?.disconnect(); };
  }, []);

  // Fix: When scroll is already at bottom and more items can load, trigger load more.
  // IntersectionObserver only fires on visibility *changes* — if user is at bottom from the start,
  // the sentinel may already be visible and no callback fires. Check on content updates AND on scroll.
  const BOTTOM_THRESHOLD = 250;
  const checkAtBottomAndLoad = useCallback(() => {
    if (loadingMore || !cursor || items.length === 0) return;
    const scrollBottom = window.scrollY + window.innerHeight;
    const docBottom = document.documentElement.scrollHeight - BOTTOM_THRESHOLD;
    if (scrollBottom >= docBottom) loadMoreRef.current();
  }, [items.length, cursor, loadingMore]);

  useEffect(() => {
    const raf = requestAnimationFrame(checkAtBottomAndLoad);
    return () => cancelAnimationFrame(raf);
  }, [checkAtBottomAndLoad]);

  useEffect(() => {
    let scrollRaf: number | null = null;
    const onScroll = () => {
      if (scrollRaf != null) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        checkAtBottomAndLoad();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollRaf != null) cancelAnimationFrame(scrollRaf);
    };
  }, [checkAtBottomAndLoad]);

  const handleRemoveFavorite = async (e: React.MouseEvent, contentItemId: string) => {
    e.stopPropagation();
    if (removingId) return;
    setRemovingId(contentItemId);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contentItemId }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.contentItemId !== contentItemId));
        setTotalCount((prev) => prev - 1);
      }
    } finally {
      setRemovingId(null);
    }
  };

  const handleItemClick = (item: FavoriteItem) => {
    const params = new URLSearchParams();
    if (activeFilter !== "ALL") params.set("filter", activeFilter);
    const qs = params.toString();
    router.push(qs ? `/favorites/${item.contentItemId}?${qs}` : `/favorites/${item.contentItemId}`);
  };

  const filteredItems = activeFilter === "ALL"
    ? items
    : items.filter((i) => i.contentType === activeFilter);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6 slide-up">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t("title")}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {totalCount} {totalCount === 1 ? "item" : "items"}
          </p>
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex items-center gap-2 mb-6 slide-up" style={{ animationDelay: "0.1s" }}>
          <Button
            variant={activeFilter === "ALL" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter("ALL")}
            className="gap-1.5"
          >
            All
          </Button>
          <Button
            variant={activeFilter === "VIDEO" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter("VIDEO")}
            className="gap-1.5"
          >
            <Film className="h-3.5 w-3.5" />
            Videos
          </Button>
          <Button
            variant={activeFilter === "PHOTO" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveFilter("PHOTO")}
            className="gap-1.5"
          >
            <Camera className="h-3.5 w-3.5" />
            Photos
          </Button>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground scale-in">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-4">
            <Heart className="h-7 w-7 opacity-30" />
          </div>
          <p className="text-base font-medium">{t("noFavorites")}</p>
          <p className="text-sm mt-1.5 text-muted-foreground/60">{t("noFavoritesDesc")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredItems.map((item, index) => (
              <div
                key={item.id}
                className={cn("cursor-pointer group animate-in fade-in grid-item-contain", `stagger-${Math.min(index % 10 + 1, 10)}`)}
                onClick={() => handleItemClick(item)}
              >
                <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-card border border-white/[0.06] card-hover group-hover:border-primary/30 transition-all duration-300">
                  <LazyRetryImage
                    src={contentThumbnailSrc(item.contentItemId, item.thumbnailUrl, {
                      cdnMaxWidth: 560,
                    })}
                    fallbackSrc={contentThumbnailProxySrc(item.contentItemId)}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
                    rootMargin="600px"
                    fallback={
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-secondary">
                        {item.contentType === "VIDEO" ? (
                          <Play className="h-8 w-8 text-muted-foreground/30" />
                        ) : (
                          <Image className="h-8 w-8 text-muted-foreground/30" />
                        )}
                      </div>
                    }
                  />

                  {/* Remove favorite button */}
                  <button
                    type="button"
                    className="absolute top-2 right-2 min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded-lg bg-black/40 hover:bg-black/55 transition-all z-10 cursor-pointer"
                    onClick={(e) => handleRemoveFavorite(e, item.contentItemId)}
                    disabled={removingId === item.contentItemId}
                    aria-label={t("removeFromFavorites")}
                  >
                    <Heart
                      className={cn(
                        "h-3.5 w-3.5 fill-primary text-primary transition-transform",
                        removingId === item.contentItemId && "animate-pulse"
                      )}
                    />
                  </button>

                  {/* Duration badge */}
                  {item.contentType === "VIDEO" && item.duration && item.duration > 0 && (
                    <div className="absolute bottom-2 right-2 z-10 pointer-events-none">
                      <span className="bg-black/75 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-md">
                        {formatDuration(item.duration)}
                      </span>
                    </div>
                  )}

                  {/* Model name + gradient */}
                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
                    <p className="text-xs text-white/80 font-medium truncate">{item.modelName}</p>
                  </div>

                  {/* Type badge */}
                  <div className="absolute top-2 left-2">
                    <Badge variant="secondary" className="text-[10px] bg-black/55 text-white border-0 px-1.5 py-0.5">
                      {item.contentType === "VIDEO" ? (
                        <><Play className="h-2.5 w-2.5 mr-0.5" /> Video</>
                      ) : (
                        <><Image className="h-2.5 w-2.5 mr-0.5" /> Photo</>
                      )}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div ref={sentinelCallbackRef} className="flex justify-center py-8">
            {loadingMore && (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
            {!loadingMore && !cursor && items.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {items.length} of {totalCount} items
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
