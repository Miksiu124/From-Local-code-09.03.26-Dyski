"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Lock, Play, Image, Coins, ArrowLeft, Loader2,
  Heart, Film, Camera, ArrowUpDown,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccessRequiredPopup } from "@/components/access-required-popup";
import { cn } from "@/lib/utils";

interface ContentItem {
  id: string;
  contentType: string;
  thumbnailPath: string | null;
  duration: number | null;
}

type ContentFilter = "ALL" | "VIDEO" | "PHOTO" | "FAVORITES";
type SortOrder = "newest" | "oldest";

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface ModelDetailProps {
  model: {
    id: string;
    name: string;
    folderName: string;
    description: string | null;
    countryName: string | null;
    countryFlag: string | null;
  };
  initialContentItems: ContentItem[];
  initialCursor: string | null;
  totalContentCount: number;
  hasAccess: boolean;
  isAuthenticated: boolean;
  cost7d: number;
  cost30d: number;
  creditBalance: number;
}

export function ModelDetail({
  model,
  initialContentItems,
  initialCursor,
  totalContentCount,
  hasAccess,
  isAuthenticated,
  cost7d,
  cost30d,
  creditBalance,
}: ModelDetailProps) {
  const t = useTranslations("models");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [popupOpen, setPopupOpen] = useState(false);

  // Read initial filter/sort from URL params
  const initialFilter = (searchParams.get("filter") as ContentFilter) || "ALL";
  const initialSort = (searchParams.get("sort") as SortOrder) || "newest";

  const [contentItems, setContentItems] = useState<ContentItem[]>(initialContentItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ContentFilter>(
    ["ALL", "VIDEO", "PHOTO", "FAVORITES"].includes(initialFilter) ? initialFilter : "ALL"
  );
  const [activeSort, setActiveSort] = useState<SortOrder>(
    ["newest", "oldest"].includes(initialSort) ? initialSort : "newest"
  );
  const [filteredTotal, setFilteredTotal] = useState(totalContentCount);
  const [isFiltering, setIsFiltering] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Favorites state
  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const [togglingFav, setTogglingFav] = useState<string | null>(null);

  // Update URL query params without triggering navigation
  const updateUrlParams = useCallback((filter: ContentFilter, sort: SortOrder) => {
    const params = new URLSearchParams();
    if (filter !== "ALL") params.set("filter", filter);
    if (sort !== "newest") params.set("sort", sort);
    const qs = params.toString();
    router.replace(`/models/${model.folderName}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, model.folderName]);

  // Check which items are favorited
  const checkFavorites = useCallback(async (itemIds: string[]) => {
    if (!isAuthenticated || itemIds.length === 0) return;
    try {
      const res = await fetch("/api/favorites/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentItemIds: itemIds }),
      });
      if (res.ok) {
        const data = await res.json();
        setFavoritedIds((prev) => {
          const next = new Set(prev);
          for (const id of data.favorited) next.add(id);
          return next;
        });
      }
    } catch {
      // Ignore errors silently
    }
  }, [isAuthenticated]);

  // Check favorites for initial items
  useEffect(() => {
    if (initialContentItems.length > 0) {
      checkFavorites(initialContentItems.map((i) => i.id));
    }
  }, [initialContentItems, checkFavorites]);

  // If URL has a non-default filter/sort, fetch matching content on mount
  useEffect(() => {
    if (initialFilter !== "ALL" || initialSort !== "newest") {
      if (initialFilter !== "FAVORITES") {
        loadContent(initialFilter, initialSort);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContentClick = (contentId: string) => {
    if (!isAuthenticated || !hasAccess) {
      setPopupOpen(true);
      return;
    }
    router.push(`/content/${model.folderName}/${contentId}`);
  };

  const toggleFavorite = async (e: React.MouseEvent, contentItemId: string) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      setPopupOpen(true);
      return;
    }
    if (togglingFav) return;
    setTogglingFav(contentItemId);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentItemId }),
      });
      if (res.ok) {
        const data = await res.json();
        setFavoritedIds((prev) => {
          const next = new Set(prev);
          if (data.favorited) {
            next.add(contentItemId);
          } else {
            next.delete(contentItemId);
          }
          return next;
        });
      }
    } finally {
      setTogglingFav(null);
    }
  };

  // Load content with filter and sort
  const loadContent = useCallback(async (
    filter: ContentFilter,
    sort: SortOrder,
    append = false,
    cursorVal?: string | null,
  ) => {
    // Favorites filter is client-side only
    if (filter === "FAVORITES") {
      setIsFiltering(false);
      setLoadingMore(false);
      return;
    }

    if (append) {
      setLoadingMore(true);
    } else {
      setIsFiltering(true);
    }
    try {
      const params = new URLSearchParams({ limit: "24", sort });
      if (filter !== "ALL") params.set("type", filter);
      if (append && cursorVal) params.set("cursor", cursorVal);

      const res = await fetch(`/api/models/${model.folderName}/content?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (append) {
          setContentItems((prev) => [...prev, ...data.items]);
          checkFavorites(data.items.map((i: ContentItem) => i.id));
        } else {
          setContentItems(data.items);
          checkFavorites(data.items.map((i: ContentItem) => i.id));
        }
        setCursor(data.nextCursor);
        setFilteredTotal(data.totalCount);
      }
    } finally {
      setLoadingMore(false);
      setIsFiltering(false);
    }
  }, [model.folderName, checkFavorites]);

  // Handle filter change
  const handleFilterChange = (filter: ContentFilter) => {
    if (filter === activeFilter) return;
    setActiveFilter(filter);
    setCursor(null);
    updateUrlParams(filter, activeSort);
    if (filter !== "FAVORITES") {
      loadContent(filter, activeSort);
    }
  };

  // Handle sort change
  const handleSortChange = () => {
    const next: SortOrder = activeSort === "newest" ? "oldest" : "newest";
    setActiveSort(next);
    setCursor(null);
    updateUrlParams(activeFilter, next);
    if (activeFilter !== "FAVORITES") {
      loadContent(activeFilter, next);
    }
  };

  // Load more (infinite scroll)
  const loadMore = useCallback(() => {
    if (loadingMore || !cursor || activeFilter === "FAVORITES") return;
    loadContent(activeFilter, activeSort, true, cursor);
  }, [loadingMore, cursor, activeFilter, activeSort, loadContent]);

  // Intersection observer for infinite scroll
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

  // Derive display items (favorites filter is client-side)
  const displayItems = activeFilter === "FAVORITES"
    ? contentItems.filter((i) => favoritedIds.has(i.id))
    : contentItems;

  const displayTotal = activeFilter === "FAVORITES"
    ? displayItems.length
    : filteredTotal;

  return (
    <>
      {/* Header */}
      <div className="mb-6">
        <Link href="/models" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          {t("allModels")}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{model.name}</h1>
            {model.countryFlag && model.countryName && (
              <p className="text-muted-foreground mt-1">
                {model.countryFlag} {model.countryName}
              </p>
            )}
            {model.description && (
              <p className="text-muted-foreground mt-2">{model.description}</p>
            )}
            <p className="text-sm text-muted-foreground mt-2">
              {displayTotal} {t("items")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {hasAccess ? (
              <Badge variant="success" className="text-sm px-3 py-1.5">
                {t("purchased")}
              </Badge>
            ) : (
              <Button onClick={() => setPopupOpen(true)} size="lg">
                <Coins className="h-4 w-4 mr-2" />
                Unlock from {cost7d} Credits
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Filters + Sort row */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Button
          variant={activeFilter === "ALL" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("ALL")}
          disabled={isFiltering}
          className="gap-1.5"
        >
          All
        </Button>
        <Button
          variant={activeFilter === "VIDEO" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("VIDEO")}
          disabled={isFiltering}
          className="gap-1.5"
        >
          <Film className="h-3.5 w-3.5" />
          Videos
        </Button>
        <Button
          variant={activeFilter === "PHOTO" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("PHOTO")}
          disabled={isFiltering}
          className="gap-1.5"
        >
          <Camera className="h-3.5 w-3.5" />
          Photos
        </Button>
        {isAuthenticated && hasAccess && (
          <Button
            variant={activeFilter === "FAVORITES" ? "default" : "outline"}
            size="sm"
            onClick={() => handleFilterChange("FAVORITES")}
            disabled={isFiltering}
            className="gap-1.5"
          >
            <Heart className={cn("h-3.5 w-3.5", activeFilter === "FAVORITES" && "fill-current")} />
            Favorites
          </Button>
        )}

        {/* Sort toggle */}
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSortChange}
            disabled={isFiltering}
            className="gap-1.5 text-muted-foreground"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {activeSort === "newest" ? "Newest" : "Oldest"}
          </Button>
        </div>

        {isFiltering && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Content Grid */}
      {displayItems.length === 0 && !loadingMore && !isFiltering ? (
        <div className="text-center py-20 text-muted-foreground">
          {activeFilter === "FAVORITES" ? (
            <>
              <Heart className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p>No favorites in this folder yet</p>
            </>
          ) : (
            <>
              <Image className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>
                {activeFilter === "ALL"
                  ? "No content items"
                  : `No ${activeFilter === "VIDEO" ? "videos" : "photos"} found`}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {displayItems.map((item) => (
              <div
                key={item.id}
                className="cursor-pointer group animate-in fade-in duration-300"
                onClick={() => handleContentClick(item.id)}
              >
                <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-muted border border-border group-hover:border-primary/50 transition-all duration-300">
                  {/* Thumbnail */}
                  {hasAccess ? (
                    <>
                      <img
                        src={`/api/content/${item.id}/thumbnail`}
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
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-secondary">
                      {item.contentType === "VIDEO" ? (
                        <Play className="h-8 w-8 text-muted-foreground/30" />
                      ) : (
                        <Image className="h-8 w-8 text-muted-foreground/30" />
                      )}
                    </div>
                  )}

                  {/* Lock overlay */}
                  {!hasAccess && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <Lock className="h-8 w-8 text-white/50" />
                    </div>
                  )}

                  {/* Favorite button */}
                  {isAuthenticated && hasAccess && (
                    <button
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors z-10"
                      onClick={(e) => toggleFavorite(e, item.id)}
                      disabled={togglingFav === item.id}
                    >
                      <Heart
                        className={cn(
                          "h-4 w-4 transition-colors",
                          favoritedIds.has(item.id)
                            ? "fill-red-500 text-red-500"
                            : "text-white/80 hover:text-red-400"
                        )}
                      />
                    </button>
                  )}

                  {/* Duration badge (videos only) */}
                  {item.contentType === "VIDEO" && item.duration && item.duration > 0 && (
                    <span className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-medium px-1 py-0.5 rounded z-[5]">
                      {formatDuration(item.duration)}
                    </span>
                  )}

                  {/* Type badge */}
                  <div className="absolute bottom-2 left-2">
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
            {!loadingMore && !cursor && displayItems.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {displayItems.length} of {displayTotal} items
              </p>
            )}
          </div>
        </>
      )}

      <AccessRequiredPopup
        open={popupOpen}
        onOpenChange={setPopupOpen}
        modelId={model.id}
        modelName={model.name}
        cost7d={cost7d}
        cost30d={cost30d}
        isAuthenticated={isAuthenticated}
        initialCreditBalance={creditBalance}
      />
    </>
  );
}
