"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Heart, Play, Image, Loader2, Film, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FavoriteItem {
  id: string;
  contentItemId: string;
  contentType: string;
  thumbnailPath: string | null;
  modelName: string;
  modelSlug: string;
  createdAt: string;
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
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchFavorites = useCallback(async (cursorVal?: string | null, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (cursorVal) params.set("cursor", cursorVal);

      const res = await fetch(`/api/favorites?${params.toString()}`);
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

  const loadMore = useCallback(() => {
    if (loadingMore || !cursor) return;
    fetchFavorites(cursor, true);
  }, [loadingMore, cursor, fetchFavorites]);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor && !loadingMore) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, loadingMore, loadMore]);

  const handleRemoveFavorite = async (e: React.MouseEvent, contentItemId: string) => {
    e.stopPropagation();
    if (removingId) return;
    setRemovingId(contentItemId);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    router.push(`/content/${item.modelSlug}/${item.contentItemId}`);
  };

  // Filter items client-side
  const filteredItems = activeFilter === "ALL"
    ? items
    : items.filter((i) => i.contentType === activeFilter);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount} {totalCount === 1 ? "item" : "items"}
          </p>
        </div>
      </div>

      {/* Content Type Filters */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 mb-6">
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
        <div className="text-center py-20 text-muted-foreground">
          <Heart className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">{t("noFavorites")}</p>
          <p className="text-sm mt-2">{t("noFavoritesDesc")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="cursor-pointer group animate-in fade-in duration-300"
                onClick={() => handleItemClick(item)}
              >
                <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-muted border border-border group-hover:border-primary/50 transition-all duration-300">
                  <img
                    src={`/api/content/${item.contentItemId}/thumbnail`}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      img.style.display = "none";
                      const fallback = img.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = "flex";
                    }}
                  />
                  <div
                    className="absolute inset-0 items-center justify-center bg-gradient-to-br from-muted to-secondary"
                    style={{ display: "none" }}
                  >
                    {item.contentType === "VIDEO" ? (
                      <Play className="h-8 w-8 text-muted-foreground/30" />
                    ) : (
                      <Image className="h-8 w-8 text-muted-foreground/30" />
                    )}
                  </div>

                  {/* Remove favorite button */}
                  <button
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors z-10"
                    onClick={(e) => handleRemoveFavorite(e, item.contentItemId)}
                    disabled={removingId === item.contentItemId}
                  >
                    <Heart
                      className={cn(
                        "h-4 w-4 fill-red-500 text-red-500 transition-transform",
                        removingId === item.contentItemId && "animate-pulse"
                      )}
                    />
                  </button>

                  {/* Model name */}
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
                    <p className="text-xs text-white/90 font-medium truncate">{item.modelName}</p>
                  </div>

                  {/* Type badge */}
                  <div className="absolute bottom-2 right-2">
                    <Badge variant="secondary" className="text-xs">
                      {item.contentType === "VIDEO" ? (
                        <><Play className="h-3 w-3 mr-1" /> Video</>
                      ) : (
                        <><Image className="h-3 w-3 mr-1" /> Photo</>
                      )}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="flex justify-center py-8">
            {loadingMore && (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
            {!loadingMore && !cursor && items.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {items.length} of {totalCount} items
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
