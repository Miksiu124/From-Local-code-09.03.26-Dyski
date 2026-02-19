"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Lock, Play, Image, Coins, ArrowLeft, Loader2,
  Heart, Film, Camera, ArrowUpDown, Clock, ShoppingCart,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ContentItem {
  id: string;
  contentType: string;
  thumbnailPath: string | null;
  duration: number | null;
}

type ContentFilter = "ALL" | "VIDEO" | "PHOTO" | "FAVORITES";
type SortOrder = "newest" | "oldest" | "longest" | "shortest";

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

  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(false);
  const [realBalance, setRealBalance] = useState(creditBalance);

  const initialFilter = (searchParams.get("filter") as ContentFilter) || "ALL";
  const initialSort = (searchParams.get("sort") as SortOrder) || "newest";

  const [contentItems, setContentItems] = useState<ContentItem[]>(initialContentItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ContentFilter>(
    ["ALL", "VIDEO", "PHOTO", "FAVORITES"].includes(initialFilter) ? initialFilter : "ALL"
  );
  const [activeSort, setActiveSort] = useState<SortOrder>(
    ["newest", "oldest", "longest", "shortest"].includes(initialSort) ? initialSort : "newest"
  );
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [filteredTotal, setFilteredTotal] = useState(totalContentCount);
  const [isFiltering, setIsFiltering] = useState(false);

  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const [togglingFav, setTogglingFav] = useState<string | null>(null);

  useEffect(() => {
    const key = `scroll_model_${model.folderName}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const y = parseInt(saved, 10);
      sessionStorage.removeItem(key);
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
    }
  }, [model.folderName]);

  const updateUrlParams = useCallback((filter: ContentFilter, sort: SortOrder) => {
    const params = new URLSearchParams();
    if (filter !== "ALL") params.set("filter", filter);
    if (sort !== "newest") params.set("sort", sort);
    const qs = params.toString();
    router.replace(`/models/${model.folderName}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, model.folderName]);

  const checkFavorites = useCallback(async (itemIds: string[]) => {
    if (!isAuthenticated || itemIds.length === 0) return;
    try {
      const res = await fetch("/api/favorites/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
      // Silently ignore
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (initialContentItems.length > 0) {
      checkFavorites(initialContentItems.map((i) => i.id));
    }
  }, [initialContentItems, checkFavorites]);

  const handleModelPurchase = async (duration: "SEVEN_DAYS" | "THIRTY_DAYS") => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }

    setPurchasing(true);
    setPurchaseError(null);
    setShowInsufficientCredits(false);

    try {
      const balanceRes = await fetch("/api/user/balance");
      if (balanceRes.ok) {
        const data = await balanceRes.json();
        setRealBalance(data.creditBalance);
        const needed = duration === "SEVEN_DAYS" ? cost7d : cost30d;
        if (data.creditBalance < needed) {
          setShowInsufficientCredits(true);
          setPurchasing(false);
          return;
        }
      }

      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: model.id, accessDuration: duration }),
      });

      if (!res.ok) {
        const data = await res.json();
        setPurchaseError(data.error?.message || data.error || "Purchase failed");
        return;
      }

      router.refresh();
    } catch {
      setPurchaseError("Purchase failed. Please try again.");
    } finally {
      setPurchasing(false);
    }
  };

  const handleContentClick = (contentId: string) => {
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (!hasAccess) return;
    sessionStorage.setItem(`scroll_model_${model.folderName}`, String(window.scrollY));
    sessionStorage.setItem(`filter_model_${model.folderName}`, activeFilter);
    sessionStorage.setItem(`sort_model_${model.folderName}`, activeSort);
    router.push(`/content/${model.folderName}/${contentId}`);
  };

  const toggleFavorite = async (e: React.MouseEvent, contentItemId: string) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      router.push("/login");
      return;
    }
    if (togglingFav) return;
    setTogglingFav(contentItemId);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
      } else {
        console.error("[Favorites] Toggle failed:", res.status);
      }
    } catch (err) {
      console.error("[Favorites] Toggle error:", err);
    } finally {
      setTogglingFav(null);
    }
  };

  const loadContent = useCallback(async (
    filter: ContentFilter,
    sort: SortOrder,
    append = false,
    cursorVal?: string | null,
  ) => {
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

  const handleFilterChange = (filter: ContentFilter) => {
    if (filter === activeFilter) return;
    setActiveFilter(filter);
    setCursor(null);
    updateUrlParams(filter, activeSort);
    if (filter !== "FAVORITES") {
      loadContent(filter, activeSort);
    }
  };

  const handleSortChange = (next: SortOrder) => {
    if (next === activeSort) {
      setSortMenuOpen(false);
      return;
    }
    setActiveSort(next);
    setSortMenuOpen(false);
    setCursor(null);
    updateUrlParams(activeFilter, next);
    if (activeFilter !== "FAVORITES") {
      loadContent(activeFilter, next);
    }
  };

  const loadMoreRef = useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    if (loadingMore || !cursor || activeFilter === "FAVORITES") return;
    loadContent(activeFilter, activeSort, true, cursor);
  };

  const observerRef = useRef<IntersectionObserver | null>(null);

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
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const displayItems = activeFilter === "FAVORITES"
    ? contentItems.filter((i) => favoritedIds.has(i.id))
    : contentItems;

  const displayTotal = activeFilter === "FAVORITES"
    ? displayItems.length
    : filteredTotal;

  return (
    <>
      {/* Header */}
      <div className="mb-6 slide-up">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("allModels")}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">{model.name}</h1>
            {model.countryFlag && model.countryName && (
              <p className="text-muted-foreground mt-1 text-sm">
                {model.countryFlag} {model.countryName}
              </p>
            )}
            {model.description && (
              <p className="text-muted-foreground mt-2 text-sm max-w-xl">{model.description}</p>
            )}
            <p className="text-xs text-muted-foreground/60 mt-2">
              {displayTotal} {t("items")}
            </p>
          </div>
          {hasAccess && (
            <Badge variant="success" className="text-xs px-3 py-1.5 shrink-0">
              {t("purchased")}
            </Badge>
          )}
        </div>
      </div>

      {/* Pricing Card */}
      {!hasAccess && (
        <div className="mb-8 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/5 via-purple-500/5 to-primary/5 p-5 sm:p-6 slide-up" style={{ animationDelay: "0.1s" }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-base sm:text-lg font-bold">{t("unlockAccess")}</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-5">
            {t("chooseAccessPlan", { modelName: model.name })}
          </p>

          <div className="grid grid-cols-2 gap-3 max-w-md">
            <button
              className="relative flex flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5 hover:border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50 cursor-pointer press-effect"
              onClick={() => handleModelPurchase("SEVEN_DAYS")}
              disabled={purchasing}
            >
              <Clock className="h-4 w-4 text-muted-foreground mb-2" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">7 {t("days")}</span>
              <span className="text-lg sm:text-xl font-bold">{cost7d} {t("credits")}</span>
            </button>

            <button
              className="relative flex flex-col items-center justify-center rounded-xl border border-primary/25 bg-primary/10 p-4 sm:p-5 hover:border-primary/40 hover:bg-primary/15 transition-all disabled:opacity-50 cursor-pointer press-effect"
              onClick={() => handleModelPurchase("THIRTY_DAYS")}
              disabled={purchasing}
            >
              <div className="absolute -right-1.5 -top-1.5 bg-primary text-primary-foreground text-[9px] font-black px-2 py-0.5 rounded-lg">
                {t("bestValue")}
              </div>
              <Clock className="h-4 w-4 text-primary mb-2" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">30 {t("days")}</span>
              <span className="text-lg sm:text-xl font-bold">{cost30d} {t("credits")}</span>
            </button>
          </div>

          {purchasing && (
            <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("processing")}
            </div>
          )}

          {showInsufficientCredits && (
            <div className="mt-4 rounded-xl border border-yellow-500/15 bg-yellow-500/5 p-4">
              <p className="text-sm text-yellow-200 mb-2">
                {t("insufficientCredits", { balance: realBalance })}
              </p>
              <Link href="/purchase">
                <Button size="sm" variant="default">
                  <Coins className="h-4 w-4 mr-2" />
                  {t("buyCredits")}
                </Button>
              </Link>
            </div>
          )}

          {purchaseError && (
            <p className="text-sm text-destructive mt-3">{purchaseError}</p>
          )}
        </div>
      )}

      {/* Filters + Sort row */}
      <div className="flex items-center gap-2 mb-6 flex-wrap slide-up" style={{ animationDelay: "0.15s" }}>
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

        {/* Sort dropdown */}
        <div className="ml-auto relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSortMenuOpen((v) => !v)}
            disabled={isFiltering}
            className="gap-1.5 text-muted-foreground"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {{ newest: "Newest", oldest: "Oldest", longest: "Longest", shortest: "Shortest" }[activeSort]}
          </Button>
          {sortMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-xl border border-white/[0.08] bg-card/95 backdrop-blur-xl p-1 shadow-2xl">
                {([
                  { value: "newest", label: "Newest", icon: <Clock className="h-3.5 w-3.5" /> },
                  { value: "oldest", label: "Oldest", icon: <Clock className="h-3.5 w-3.5" /> },
                  { value: "longest", label: "Longest", icon: <Film className="h-3.5 w-3.5" /> },
                  { value: "shortest", label: "Shortest", icon: <Film className="h-3.5 w-3.5" /> },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleSortChange(opt.value)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors cursor-pointer",
                      activeSort === opt.value
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                    )}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {isFiltering && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Content Grid */}
      {displayItems.length === 0 && !loadingMore && !isFiltering ? (
        <div className="text-center py-20 text-muted-foreground scale-in">
          {activeFilter === "FAVORITES" ? (
            <>
              <div className="mx-auto h-16 w-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-4">
                <Heart className="h-7 w-7 opacity-30" />
              </div>
              <p className="font-medium">No favorites in this folder yet</p>
            </>
          ) : (
            <>
              <div className="mx-auto h-16 w-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-4">
                <Image className="h-7 w-7 opacity-30" />
              </div>
              <p className="font-medium">
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
            {displayItems.map((item, index) => (
              <div
                key={item.id}
                className={cn("cursor-pointer group animate-in fade-in", `stagger-${Math.min(index % 10 + 1, 10)}`)}
                onClick={() => handleContentClick(item.id)}
              >
                <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-card border border-white/[0.06] card-hover group-hover:border-primary/30 transition-all duration-300">
                  {hasAccess ? (
                    <>
                      <img
                        src={`/api/content/${item.id}/thumbnail`}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
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

                  {!hasAccess && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
                      <Lock className="h-7 w-7 text-white/40" />
                    </div>
                  )}

                  {/* Duration badge */}
                  {item.contentType === "VIDEO" && item.duration && item.duration > 0 && (
                    <div className="absolute bottom-2 right-2 z-10 pointer-events-none">
                      <span className="bg-black/70 backdrop-blur-sm text-white text-[10px] font-medium px-1.5 py-0.5 rounded-md">
                        {formatDuration(item.duration)}
                      </span>
                    </div>
                  )}

                  {/* Type badge */}
                  <div className="absolute top-2 left-2 z-10 pointer-events-none">
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-black/50 backdrop-blur-md text-white border-0">
                      {item.contentType === "VIDEO" ? (
                        <><Play className="h-2.5 w-2.5 mr-0.5 fill-white" /> Video</>
                      ) : (
                        <><Image className="h-2.5 w-2.5 mr-0.5" /> Photo</>
                      )}
                    </Badge>
                  </div>

                  {/* Favorite button */}
                  {isAuthenticated && (
                    <div className="absolute top-2 right-2 z-20">
                      <button
                        className="p-1.5 rounded-lg bg-black/30 backdrop-blur-sm hover:bg-black/50 transition-all cursor-pointer"
                        onClick={(e) => toggleFavorite(e, item.id)}
                        disabled={togglingFav === item.id}
                      >
                        <Heart
                          className={cn(
                            "h-3.5 w-3.5 transition-colors",
                            favoritedIds.has(item.id)
                              ? "fill-red-500 text-red-500"
                              : "text-white hover:text-red-400"
                          )}
                        />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div key={`sentinel-${activeFilter}-${activeSort}`} ref={sentinelCallbackRef} className="flex justify-center py-8">
            {loadingMore && (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
            {!loadingMore && !cursor && displayItems.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {displayItems.length} of {displayTotal} items
              </p>
            )}
          </div>
        </>
      )}

    </>
  );
}
