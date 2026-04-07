"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Lock, Play, Image, Coins, ArrowLeft, Loader2,
  Heart, Film, Camera, ArrowUpDown, Clock, ShoppingCart, X,
  ChevronLeft, ChevronRight, Trash2, Download, LayoutGrid,
} from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { resolveApiPathForBrowser } from "@/lib/public-app-origin";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { VideoPlayer } from "@/components/user/video-player";
import { RetryImage } from "@/components/ui/retry-image";
import { LazyRetryImage } from "@/components/ui/lazy-retry-image";
import { contentThumbnailSrc, contentThumbnailProxySrc } from "@/lib/content-thumbnail";
import {
  trackFavoriteToggled,
  trackModelPageViewed,
  trackCatalogFilterUsed,
  trackContentThumbClick,
  trackContentDetailView,
  trackContentOverlayNav,
  type ContentOverlayNavKind,
} from "@/lib/growth-analytics";
import { useModelProfileEngagement } from "@/hooks/use-model-profile-engagement";

interface ContentItem {
  id: string;
  contentType: string;
  duration: number | null;
  /** Direct R2/CDN URL when backend sets R2_PUBLIC_URL; otherwise use /api/content/.../thumbnail */
  thumbnailUrl?: string | null;
}

type ContentFilter = "ALL" | "VIDEO" | "PHOTO" | "FAVORITES";
type SortOrder = "newest" | "oldest" | "longest" | "shortest";

const FILMSTRIP_RADIUS = 10;

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
  isAdmin?: boolean;
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
  isAdmin = false,
  cost7d,
  cost30d,
  creditBalance,
}: ModelDetailProps) {
  const t = useTranslations("models");
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    trackModelPageViewed(model.id, { folder_name: model.folderName });
  }, [model.id, model.folderName]);

  const { markFavorite: markProfileEngagementFavorite, markContentOpen: markProfileContentOpen } =
    useModelProfileEngagement(model.id, model.folderName);

  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(false);
  const [realBalance, setRealBalance] = useState(creditBalance);

  const initialFilter = (searchParams.get("filter") as ContentFilter) || "ALL";
  const initialSort = (searchParams.get("sort") as SortOrder) || "newest";
  const initialView = searchParams.get("view") ?? null;

  const [contentItems, setContentItems] = useState<ContentItem[]>(
    initialFilter === "FAVORITES" ? [] : initialContentItems
  );
  const [cursor, setCursor] = useState<string | null>(
    initialFilter === "FAVORITES" ? null : initialCursor
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ContentFilter>(
    ["ALL", "VIDEO", "PHOTO", "FAVORITES"].includes(initialFilter) ? initialFilter : "ALL"
  );
  const [activeSort, setActiveSort] = useState<SortOrder>(
    ["newest", "oldest", "longest", "shortest"].includes(initialSort) ? initialSort : "newest"
  );
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [overlayFolderMenuOpen, setOverlayFolderMenuOpen] = useState(false);
  const [overlayContextLoading, setOverlayContextLoading] = useState(false);
  const [filteredTotal, setFilteredTotal] = useState(
    initialFilter === "FAVORITES" ? 0 : totalContentCount
  );
  const [isFiltering, setIsFiltering] = useState(false);

  // Favorites tab uses a dedicated API; state is separate from content
  const [favoritesItems, setFavoritesItems] = useState<ContentItem[]>([]);
  const [favoritesCursor, setFavoritesCursor] = useState<string | null>(null);
  const [favoritesTotal, setFavoritesTotal] = useState(0);
  const [favoritesLoading, setFavoritesLoading] = useState(initialFilter === "FAVORITES");

  const [favoritedIds, setFavoritedIds] = useState<Set<string>>(new Set());
  const [togglingFav, setTogglingFav] = useState<string | null>(null);

  // Overlay content viewer state (persisted in URL ?view= for F5 refresh)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    initialView && hasAccess && isAuthenticated ? initialView : null
  );
  const [viewItemFallback, setViewItemFallback] = useState<ContentItem | null>(null);
  const [overlayFavorited, setOverlayFavorited] = useState(false);
  const [overlayTogglingFav, setOverlayTogglingFav] = useState(false);
  const [overlayDeleting, setOverlayDeleting] = useState(false);
  const savedScrollY = useRef(0);
  const f5RedirectCheckedRef = useRef(false);
  /** Sync mutex for pagination append — IntersectionObserver + scroll can both fire before `loadingMore` state updates; duplicate rows / duplicate React keys corrupt grid layout (giant tile). */
  const appendLoadLockedRef = useRef(false);

  // F5 fallback: when user refreshes while in video overlay, redirect to model folder.
  // Run ONLY on initial mount — if user clicked thumbnail after refresh, nav.type stays "reload"
  // but we must NOT redirect (they intentionally opened overlay). hasRun guards that.
  useEffect(() => {
    if (f5RedirectCheckedRef.current) return;
    f5RedirectCheckedRef.current = true;
    if (!initialView || !hasAccess || !isAuthenticated) return;
    const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type !== "reload") return;
    const params = new URLSearchParams();
    if (activeFilter !== "ALL") params.set("filter", activeFilter);
    if (activeSort !== "newest") params.set("sort", activeSort);
    const qs = params.toString();
    router.replace(`/models/${model.folderName}${qs ? `?${qs}` : ""}`, { scroll: false });
    setSelectedItemId(null);
    setViewItemFallback(null);
  }, [initialView, hasAccess, isAuthenticated, activeFilter, activeSort, model.folderName, router]);

  // Persist filter/sort to sessionStorage (for content-viewer back link) — sync from URL on mount
  useEffect(() => {
    sessionStorage.setItem(`filter_model_${model.folderName}`, activeFilter);
    sessionStorage.setItem(`sort_model_${model.folderName}`, activeSort);
  }, [model.folderName, activeFilter, activeSort]);

  // Restore overlay from ?view= on mount (F5 refresh) — fetch item if not in displayItems
  useEffect(() => {
    if (!initialView || !hasAccess || !isAuthenticated) return;
    const inDisplay = (activeFilter === "FAVORITES" ? favoritesItems : contentItems).some((i) => i.id === initialView);
    if (inDisplay) return;
    let cancelled = false;
    fetch(`/api/content/${model.folderName}/${initialView}/details`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data?.contentItem) return;
        setViewItemFallback({
          id: data.contentItem.id,
          contentType: data.contentItem.contentType,
          duration: data.contentItem.duration ?? null,
          thumbnailUrl: data.contentItem.thumbnailUrl ?? null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [initialView, hasAccess, isAuthenticated, model.folderName, activeFilter, contentItems, favoritesItems]);

  // Clear invalid ?view= (e.g. no access, not authenticated)
  useEffect(() => {
    if (initialView && (!hasAccess || !isAuthenticated)) {
      setSelectedItemId(null);
      setViewItemFallback(null);
      const params = new URLSearchParams();
      if (activeFilter !== "ALL") params.set("filter", activeFilter);
      if (activeSort !== "newest") params.set("sort", activeSort);
      const qs = params.toString();
      router.replace(`/models/${model.folderName}${qs ? `?${qs}` : ""}`, { scroll: false });
    }
  }, [initialView, hasAccess, isAuthenticated, router, model.folderName, activeFilter, activeSort]);

  // Restore scroll position when entering model folder (from list or from content viewer)
  useEffect(() => {
    const saved = sessionStorage.getItem(`scroll_model_${model.folderName}`);
    if (!saved) return;
    const y = parseInt(saved, 10);
    if (Number.isNaN(y) || y < 0) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      timeoutId = setTimeout(() => {
        if (!cancelled) window.scrollTo({ top: y, behavior: "instant" });
      }, 50);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [model.folderName]);

  // Close sort menu on Escape
  useEffect(() => {
    if (!sortMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSortMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sortMenuOpen]);

  // Lock body scroll when overlay is open
  useEffect(() => {
    if (selectedItemId) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [selectedItemId]);

  // Check favorite status when overlay opens
  useEffect(() => {
    if (!selectedItemId || !isAuthenticated) return;
    setOverlayFavorited(favoritedIds.has(selectedItemId));
  }, [selectedItemId, isAuthenticated, favoritedIds]);

  // Hoist displayItems — FAVORITES tab uses favorites API (both photos & videos), others use content API
  const displayItems = activeFilter === "FAVORITES" ? favoritesItems : contentItems;

  const displayTotal = activeFilter === "FAVORITES" ? favoritesTotal : filteredTotal;

  // Compute overlay data — scope navigation to displayItems so FAVORITES boundary is respected
  // viewItemFallback: when ?view= is in URL but item not in displayItems (e.g. after F5), we fetch and cache it
  const selectedItem = selectedItemId
    ? displayItems.find((i) => i.id === selectedItemId) ?? (viewItemFallback?.id === selectedItemId ? viewItemFallback : null)
    : null;
  const displaySelectedIndex = selectedItemId
    ? displayItems.findIndex((i) => i.id === selectedItemId)
    : -1;
  const overlayPrevId = displaySelectedIndex > 0 ? displayItems[displaySelectedIndex - 1].id : null;
  const overlayNextId =
    displaySelectedIndex >= 0 && displaySelectedIndex < displayItems.length - 1
      ? displayItems[displaySelectedIndex + 1].id
      : null;

  const filmstripSlice = useMemo(() => {
    if (!selectedItemId) return { items: [] as ContentItem[], activeOffset: 0 };
    const idx = displayItems.findIndex((i) => i.id === selectedItemId);
    if (idx < 0) {
      if (selectedItem) return { items: [selectedItem], activeOffset: 0 };
      return { items: [] as ContentItem[], activeOffset: 0 };
    }
    const start = Math.max(0, idx - FILMSTRIP_RADIUS);
    const end = Math.min(displayItems.length, idx + FILMSTRIP_RADIUS + 1);
    return {
      items: displayItems.slice(start, end),
      activeOffset: idx - start,
    };
  }, [displayItems, selectedItemId, selectedItem]);

  const filmstripActiveRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selectedItemId || filmstripSlice.items.length === 0) return;
    const el = filmstripActiveRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ inline: "center", block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selectedItemId, filmstripSlice.items, filmstripSlice.activeOffset]);

  useEffect(() => {
    if (!selectedItemId) setOverlayFolderMenuOpen(false);
  }, [selectedItemId]);

  useEffect(() => {
    if (!selectedItemId || !selectedItem) return;
    trackContentDetailView(selectedItemId, {
      surface: "model_overlay",
      content_type: selectedItem.contentType,
      model_id: model.id,
      folder_name: model.folderName,
    });
  }, [selectedItemId, selectedItem, model.id, model.folderName]);

  const overlayRef = useRef<HTMLDivElement>(null);
  /** Gate portal until client — avoids SSR/hydration mismatch; useLayoutEffect runs before paint. */
  const [overlayPortalReady, setOverlayPortalReady] = useState(false);
  useLayoutEffect(() => {
    setOverlayPortalReady(true);
  }, []);

  const buildModelUrl = useCallback((opts: { filter?: ContentFilter; sort?: SortOrder; view?: string | null }) => {
    const params = new URLSearchParams();
    const filter = opts.filter ?? activeFilter;
    const sort = opts.sort ?? activeSort;
    if (filter !== "ALL") params.set("filter", filter);
    if (sort !== "newest") params.set("sort", sort);
    if (opts.view) params.set("view", opts.view);
    const qs = params.toString();
    return `/models/${model.folderName}${qs ? `?${qs}` : ""}`;
  }, [model.folderName, activeFilter, activeSort]);

  const requestMobileFullscreen = useCallback((el: HTMLElement | null) => {
    if (!el || window.innerWidth >= 768) return;
    try {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => { });
      } else if ((el as any).webkitRequestFullscreen) {
        (el as any).webkitRequestFullscreen();
      }
    } catch { }
  }, []);

  const exitFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
      } else if ((document as any).webkitFullscreenElement) {
        (document as any).webkitExitFullscreen();
      }
    } catch { }
  }, []);

  const closeOverlay = useCallback(() => {
    exitFullscreen();
    setSelectedItemId(null);
    setViewItemFallback(null);
    router.replace(buildModelUrl({ view: null }), { scroll: false });
    requestAnimationFrame(() => {
      window.scrollTo({ top: savedScrollY.current, behavior: "instant" });
    });
  }, [exitFullscreen, router, buildModelUrl]);

  const navigateToOverlayItem = useCallback(
    (id: string | null, nav?: ContentOverlayNavKind) => {
      if (id && selectedItemId && id !== selectedItemId) {
        trackContentOverlayNav(id, {
          from_content_item_id: selectedItemId,
          model_id: model.id,
          folder_name: model.folderName,
          nav,
        });
      }
      setSelectedItemId(id);
      if (id) setViewItemFallback(null);
      router.replace(buildModelUrl({ view: id }), { scroll: false });
    },
    [router, buildModelUrl, selectedItemId, model.id, model.folderName],
  );

  useEffect(() => {
    if (selectedItemId && overlayRef.current) {
      requestMobileFullscreen(overlayRef.current);
    }
  }, [selectedItemId, requestMobileFullscreen]);

  const overlayToggleFavorite = useCallback(async () => {
    if (!selectedItemId || overlayTogglingFav) return;
    setOverlayTogglingFav(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ contentItemId: selectedItemId }),
      });
      if (res.ok) {
        const data = await res.json();
        trackFavoriteToggled(selectedItemId, !!data.favorited, { model_id: model.id });
        markProfileEngagementFavorite();
        setOverlayFavorited(data.favorited);
        setFavoritedIds((prev) => {
          const next = new Set(prev);
          if (data.favorited) next.add(selectedItemId); else next.delete(selectedItemId);
          return next;
        });
        if (activeFilter === "FAVORITES" && !data.favorited) {
          setFavoritesItems((prev) => prev.filter((i) => i.id !== selectedItemId));
          setFavoritesTotal((prev) => Math.max(0, prev - 1));
          setSelectedItemId(null);
        }
      }
    } catch { /* ignore */ }
    finally { setOverlayTogglingFav(false); }
  }, [selectedItemId, overlayTogglingFav, activeFilter, model.id, markProfileEngagementFavorite]);

  const handleDeleteContent = useCallback(async () => {
    if (!selectedItemId || overlayDeleting) return;
    if (!confirm(t("deleteContentConfirm"))) return;
    setOverlayDeleting(true);
    try {
      const res = await fetch(`/api/admin/content/${selectedItemId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        const id = selectedItemId;
        setContentItems((prev) => prev.filter((i) => i.id !== id));
        setFavoritesItems((prev) => prev.filter((i) => i.id !== id));
        setFavoritedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setFilteredTotal((prev) => Math.max(0, prev - 1));
        if (activeFilter === "FAVORITES") setFavoritesTotal((prev) => Math.max(0, prev - 1));
        setSelectedItemId(null);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || data.error || t("contentDeleteFailed"));
      }
    } catch {
      alert(t("contentDeleteFailed"));
    } finally {
      setOverlayDeleting(false);
    }
  }, [selectedItemId, overlayDeleting, activeFilter, t]);

  const updateUrlParams = useCallback((filter: ContentFilter, sort: SortOrder, view?: string | null) => {
    sessionStorage.setItem(`filter_model_${model.folderName}`, filter);
    sessionStorage.setItem(`sort_model_${model.folderName}`, sort);
    router.replace(buildModelUrl({ filter, sort, view: view ?? undefined }), { scroll: false });
  }, [router, model.folderName, buildModelUrl]);

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
    if (initialFilter !== "FAVORITES" && initialContentItems.length > 0) {
      checkFavorites(initialContentItems.map((i) => i.id));
    }
  }, [initialFilter, initialContentItems, checkFavorites]);

  const loadFavorites = useCallback(async (
    cursorVal?: string | null,
    append = false,
  ) => {
    if (append) {
      if (appendLoadLockedRef.current) return;
      appendLoadLockedRef.current = true;
      setLoadingMore(true);
    } else {
      setIsFiltering(true);
      setFavoritesLoading(true);
    }
    try {
      const params = new URLSearchParams({
        limit: "24",
        sort: activeSort,
        modelSlug: model.folderName,
      });
      if (append && cursorVal) params.set("cursor", cursorVal);

      const res = await fetch(`/api/favorites?${params.toString()}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const mapped: ContentItem[] = (data.items || []).map((i: {
          contentItemId: string;
          contentType: string;
          duration: number | null;
          thumbnailUrl?: string | null;
        }) => ({
          id: i.contentItemId,
          contentType: i.contentType,
          duration: i.duration,
          thumbnailUrl: i.thumbnailUrl ?? null,
        }));
        if (append) {
          setFavoritesItems((prev) => {
            const seen = new Set(prev.map((i) => i.id));
            const additions = mapped.filter((i) => !seen.has(i.id));
            return additions.length ? [...prev, ...additions] : prev;
          });
        } else {
          setFavoritesItems(mapped);
        }
        setFavoritesCursor(data.nextCursor ?? null);
        setFavoritesTotal(data.totalCount ?? 0);
        setFavoritedIds((prev) => {
          const next = new Set(prev);
          mapped.forEach((i) => next.add(i.id));
          return next;
        });
      }
    } finally {
      if (append) appendLoadLockedRef.current = false;
      setLoadingMore(false);
      setIsFiltering(false);
      setFavoritesLoading(false);
    }
  }, [model.folderName, activeSort]);

  const pullFavoritesFirstPage = useCallback(
    async (
      sort: SortOrder,
    ): Promise<{ items: ContentItem[]; nextCursor: string | null; totalCount: number } | null> => {
      const params = new URLSearchParams({
        limit: "24",
        sort,
        modelSlug: model.folderName,
      });
      const res = await fetch(`/api/favorites?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      const mapped: ContentItem[] = (data.items || []).map(
        (i: {
          contentItemId: string;
          contentType: string;
          duration: number | null;
          thumbnailUrl?: string | null;
        }) => ({
          id: i.contentItemId,
          contentType: i.contentType,
          duration: i.duration,
          thumbnailUrl: i.thumbnailUrl ?? null,
        }),
      );
      return {
        items: mapped,
        nextCursor: data.nextCursor ?? null,
        totalCount: data.totalCount ?? 0,
      };
    },
    [model.folderName],
  );

  useEffect(() => {
    if (activeFilter === "FAVORITES" && isAuthenticated && hasAccess) {
      loadFavorites();
    }
  }, [activeFilter, isAuthenticated, hasAccess, activeSort, loadFavorites]);

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
    const item = displayItems.find((i) => i.id === contentId);
    const contentType = item?.contentType ?? "UNKNOWN";
    const thumbExtra = {
      content_type: contentType,
      model_id: model.id,
      folder_name: model.folderName,
      filter: activeFilter,
      sort: activeSort,
    } as const;

    if (!isAuthenticated) {
      trackContentThumbClick(contentId, { ...thumbExtra, outcome: "login_required" });
      router.push("/login");
      return;
    }
    if (!hasAccess) {
      trackContentThumbClick(contentId, { ...thumbExtra, outcome: "no_access" });
      return;
    }
    trackContentThumbClick(contentId, { ...thumbExtra, outcome: "open" });
    markProfileContentOpen();
    savedScrollY.current = window.scrollY;
    sessionStorage.setItem(`scroll_model_${model.folderName}`, String(window.scrollY));
    setSelectedItemId(contentId);
    setViewItemFallback(null);
    router.replace(buildModelUrl({ view: contentId }), { scroll: false });
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
        trackFavoriteToggled(contentItemId, !!data.favorited, {
          model_id: model.id,
          folder_name: model.folderName,
        });
        markProfileEngagementFavorite();
        setFavoritedIds((prev) => {
          const next = new Set(prev);
          if (data.favorited) {
            next.add(contentItemId);
          } else {
            next.delete(contentItemId);
          }
          return next;
        });
        if (activeFilter === "FAVORITES" && !data.favorited) {
          setFavoritesItems((prev) => prev.filter((i) => i.id !== contentItemId));
          setFavoritesTotal((prev) => Math.max(0, prev - 1));
        }
      } else {
        console.error("[Favorites] Toggle failed:", res.status);
      }
    } catch (err) {
      console.error("[Favorites] Toggle error:", err);
    } finally {
      setTogglingFav(null);
    }
  };

  const pullModelContentPage = useCallback(
    async (
      filter: ContentFilter,
      sort: SortOrder,
      append: boolean,
      cursorVal?: string | null,
    ): Promise<{ items: ContentItem[]; nextCursor: string | null; totalCount: number } | null> => {
      if (filter === "FAVORITES") return null;
      const params = new URLSearchParams({ limit: "24", sort });
      if (filter !== "ALL") params.set("type", filter);
      if (append && cursorVal) params.set("cursor", cursorVal);
      const res = await fetch(`/api/models/${model.folderName}/content?${params.toString()}`);
      if (!res.ok) return null;
      const data = await res.json();
      const rawItems: ContentItem[] = data.items ?? [];
      return {
        items: rawItems,
        nextCursor: data.nextCursor ?? null,
        totalCount: data.totalCount ?? 0,
      };
    },
    [model.folderName],
  );

  const loadContent = useCallback(
    async (
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
        if (appendLoadLockedRef.current) return;
        appendLoadLockedRef.current = true;
        setLoadingMore(true);
      } else {
        setIsFiltering(true);
      }
      try {
        const page = await pullModelContentPage(filter, sort, append, cursorVal);
        if (page) {
          if (append) {
            setContentItems((prev) => {
              const seen = new Set(prev.map((i) => i.id));
              const additions = page.items.filter((i) => !seen.has(i.id));
              return additions.length ? [...prev, ...additions] : prev;
            });
            checkFavorites(page.items.map((i: ContentItem) => i.id));
          } else {
            setContentItems(page.items);
            checkFavorites(page.items.map((i: ContentItem) => i.id));
          }
          setCursor(page.nextCursor);
          setFilteredTotal(page.totalCount);
        }
      } finally {
        if (append) appendLoadLockedRef.current = false;
        setLoadingMore(false);
        setIsFiltering(false);
      }
    },
    [pullModelContentPage, checkFavorites],
  );

  const triggerLoadMoreForNav = useCallback(() => {
    if (loadingMore) return;
    if (activeFilter === "FAVORITES") {
      if (favoritesCursor) loadFavorites(favoritesCursor, true);
    } else {
      if (cursor) loadContent(activeFilter, activeSort, true, cursor);
    }
  }, [loadingMore, activeFilter, favoritesCursor, cursor, activeSort, loadFavorites, loadContent]);

  // Keyboard handler for overlay
  useEffect(() => {
    if (!selectedItemId) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (overlayFolderMenuOpen) {
          setOverlayFolderMenuOpen(false);
          return;
        }
        closeOverlay();
        return;
      }
      const isVideo = selectedItem?.contentType === "VIDEO";
      if (isVideo ? (e.key === "ArrowLeft" && e.shiftKey) : e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        if (overlayPrevId) navigateToOverlayItem(overlayPrevId, "keyboard");
      } else if (isVideo ? (e.key === "ArrowRight" && e.shiftKey) : e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (overlayNextId) {
          navigateToOverlayItem(overlayNextId, "keyboard");
        } else if (cursor || favoritesCursor) {
          pendingNextAfterLoadRef.current = true;
          triggerLoadMoreForNav();
        }
      }
    };
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [
    selectedItemId,
    selectedItem,
    overlayPrevId,
    overlayNextId,
    overlayFolderMenuOpen,
    closeOverlay,
    navigateToOverlayItem,
    cursor,
    favoritesCursor,
    triggerLoadMoreForNav,
  ]);

  // Fix #2: Fetch-ahead — when keyboard-navigating close to end, pre-load more items (aggressive: 6 items)
  useEffect(() => {
    if (!selectedItemId) return;
    const nearEnd = displaySelectedIndex >= Math.max(0, displayItems.length - 6);
    if (!nearEnd) return;
    if (activeFilter === "FAVORITES") {
      if (favoritesCursor && !loadingMore) loadFavorites(favoritesCursor, true);
    } else {
      if (cursor && !loadingMore) loadContent(activeFilter, activeSort, true, cursor);
    }
  }, [displaySelectedIndex, displayItems.length, cursor, favoritesCursor, loadingMore, activeFilter, activeSort, selectedItemId, loadContent, loadFavorites]);

  // Load on demand when user presses next at end — then auto-advance when content arrives
  const pendingNextAfterLoadRef = useRef(false);
  const prevLoadingMoreRef = useRef(false);
  useEffect(() => {
    if (prevLoadingMoreRef.current && !loadingMore && pendingNextAfterLoadRef.current) {
      pendingNextAfterLoadRef.current = false;
      const nextIndex = displaySelectedIndex + 1;
      if (nextIndex < displayItems.length) {
        navigateToOverlayItem(displayItems[nextIndex].id, "load_more");
      }
    }
    prevLoadingMoreRef.current = loadingMore;
  }, [loadingMore, displaySelectedIndex, displayItems, navigateToOverlayItem]);

  const handleFilterChange = (filter: ContentFilter) => {
    if (filter === activeFilter) return;
    trackCatalogFilterUsed({
      surface: "model_folder",
      model_id: model.id,
      filter,
    });
    setSelectedItemId(null);
    setViewItemFallback(null);
    setActiveFilter(filter);
    setCursor(null);
    setFavoritesCursor(null);
    updateUrlParams(filter, activeSort, null);
    if (filter === "FAVORITES") {
      // Favorites tab uses dedicated API (photos + videos), loaded by useEffect
    } else {
      loadContent(filter, activeSort);
    }
  };

  const handleSortChange = (next: SortOrder) => {
    if (next === activeSort) {
      setSortMenuOpen(false);
      return;
    }
    setSelectedItemId(null);
    setViewItemFallback(null);
    setActiveSort(next);
    setSortMenuOpen(false);
    setCursor(null);
    setFavoritesCursor(null);
    updateUrlParams(activeFilter, next, null);
    if (activeFilter === "FAVORITES") {
      loadFavorites();
    } else {
      loadContent(activeFilter, next);
    }
  };

  /** Close gallery overlay and sync URL when the new folder context has no items to show. */
  const dismissOverlayToGrid = useCallback(
    (filter: ContentFilter, sort: SortOrder) => {
      exitFullscreen();
      setSelectedItemId(null);
      setViewItemFallback(null);
      updateUrlParams(filter, sort, null);
      requestAnimationFrame(() => {
        window.scrollTo({ top: savedScrollY.current, behavior: "instant" });
      });
    },
    [exitFullscreen, updateUrlParams],
  );

  const applyOverlayFilterChange = useCallback(
    async (filter: ContentFilter) => {
      if (filter === activeFilter) {
        setOverlayFolderMenuOpen(false);
        return;
      }
      if (!selectedItemId || !hasAccess || !isAuthenticated) return;
      setOverlayFolderMenuOpen(false);
      const keepId = selectedItemId;
      trackCatalogFilterUsed({ surface: "model_overlay", model_id: model.id, filter });
      setOverlayContextLoading(true);
      try {
        if (filter === "FAVORITES") {
          const page = await pullFavoritesFirstPage(activeSort);
          if (!page) return;
          setActiveFilter("FAVORITES");
          setFavoritesItems(page.items);
          setFavoritesCursor(page.nextCursor);
          setFavoritesTotal(page.totalCount);
          setCursor(null);
          setFavoritedIds((prev) => {
            const next = new Set(prev);
            page.items.forEach((i) => next.add(i.id));
            return next;
          });
          const viewId = page.items.some((i) => i.id === keepId) ? keepId : page.items[0]?.id ?? null;
          if (viewId == null) {
            dismissOverlayToGrid("FAVORITES", activeSort);
            return;
          }
          setSelectedItemId(viewId);
          setViewItemFallback(null);
          router.replace(buildModelUrl({ filter: "FAVORITES", sort: activeSort, view: viewId }), { scroll: false });
        } else {
          const page = await pullModelContentPage(filter, activeSort, false, null);
          if (!page) return;
          setActiveFilter(filter);
          setContentItems(page.items);
          setCursor(page.nextCursor);
          setFilteredTotal(page.totalCount);
          setFavoritesCursor(null);
          checkFavorites(page.items.map((i) => i.id));
          const viewId = page.items.some((i) => i.id === keepId) ? keepId : page.items[0]?.id ?? null;
          if (viewId == null) {
            dismissOverlayToGrid(filter, activeSort);
            return;
          }
          setSelectedItemId(viewId);
          setViewItemFallback(null);
          router.replace(buildModelUrl({ filter, sort: activeSort, view: viewId }), { scroll: false });
        }
      } finally {
        setOverlayContextLoading(false);
      }
    },
    [
      activeFilter,
      activeSort,
      selectedItemId,
      hasAccess,
      isAuthenticated,
      model.id,
      pullFavoritesFirstPage,
      pullModelContentPage,
      router,
      buildModelUrl,
      checkFavorites,
      dismissOverlayToGrid,
    ],
  );

  const applyOverlaySortChange = useCallback(
    async (sort: SortOrder) => {
      if (sort === activeSort) {
        setOverlayFolderMenuOpen(false);
        return;
      }
      if (!selectedItemId || !hasAccess || !isAuthenticated) return;
      setOverlayFolderMenuOpen(false);
      const keepId = selectedItemId;
      const filterAtStart = activeFilter;
      setOverlayContextLoading(true);
      try {
        if (filterAtStart === "FAVORITES") {
          const page = await pullFavoritesFirstPage(sort);
          if (!page) return;
          setActiveSort(sort);
          setFavoritesItems(page.items);
          setFavoritesCursor(page.nextCursor);
          setFavoritesTotal(page.totalCount);
          setFavoritedIds((prev) => {
            const next = new Set(prev);
            page.items.forEach((i) => next.add(i.id));
            return next;
          });
          const viewId = page.items.some((i) => i.id === keepId) ? keepId : page.items[0]?.id ?? null;
          if (viewId == null) {
            dismissOverlayToGrid("FAVORITES", sort);
            return;
          }
          setSelectedItemId(viewId);
          setViewItemFallback(null);
          router.replace(buildModelUrl({ filter: "FAVORITES", sort, view: viewId }), { scroll: false });
        } else {
          const page = await pullModelContentPage(filterAtStart, sort, false, null);
          if (!page) return;
          setActiveSort(sort);
          setContentItems(page.items);
          setCursor(page.nextCursor);
          setFilteredTotal(page.totalCount);
          checkFavorites(page.items.map((i) => i.id));
          const viewId = page.items.some((i) => i.id === keepId) ? keepId : page.items[0]?.id ?? null;
          if (viewId == null) {
            dismissOverlayToGrid(filterAtStart, sort);
            return;
          }
          setSelectedItemId(viewId);
          setViewItemFallback(null);
          router.replace(buildModelUrl({ filter: filterAtStart, sort, view: viewId }), { scroll: false });
        }
      } finally {
        setOverlayContextLoading(false);
      }
    },
    [
      activeFilter,
      activeSort,
      selectedItemId,
      hasAccess,
      isAuthenticated,
      pullFavoritesFirstPage,
      pullModelContentPage,
      router,
      buildModelUrl,
      checkFavorites,
      dismissOverlayToGrid,
    ],
  );

  const loadMoreRef = useRef<() => void>(() => { });
  loadMoreRef.current = () => {
    if (loadingMore) return;
    if (activeFilter === "FAVORITES") {
      if (!favoritesCursor) return;
      loadFavorites(favoritesCursor, true);
    } else {
      if (!cursor) return;
      loadContent(activeFilter, activeSort, true, cursor);
    }
  };

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelElRef = useRef<HTMLDivElement | null>(null);

  const attachSentinelObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    const node = sentinelElRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreRef.current();
        }
      },
      { root: null, rootMargin: "200px" }
    );
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  // Prevent empty state flash during fast scroll / dev tools viewport changes.
  // Only show empty state after we're confident (debounced) to avoid brief "Pusto"-like glitches.
  const [showEmptyState, setShowEmptyState] = useState(false);
  const emptyStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDisplayCountRef = useRef(displayItems.length);
  useEffect(() => {
    const empty = displayItems.length === 0 && !loadingMore && !isFiltering;
    if (!empty) {
      if (emptyStateTimeoutRef.current) {
        clearTimeout(emptyStateTimeoutRef.current);
        emptyStateTimeoutRef.current = null;
      }
      setShowEmptyState(false);
      prevDisplayCountRef.current = displayItems.length;
      return;
    }
    if (prevDisplayCountRef.current > 0) {
      // Had content, now empty — debounce 250ms to avoid flash during scroll/load race
      emptyStateTimeoutRef.current = setTimeout(() => {
        emptyStateTimeoutRef.current = null;
        setShowEmptyState(true);
      }, 250);
    } else {
      setShowEmptyState(true);
    }
    prevDisplayCountRef.current = 0;
    return () => {
      if (emptyStateTimeoutRef.current) clearTimeout(emptyStateTimeoutRef.current);
    };
  }, [displayItems.length, loadingMore, isFiltering]);

  const sentinelCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      sentinelElRef.current = node;
      attachSentinelObserver();
    },
    [attachSentinelObserver]
  );

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  // Fix: When scroll is already at bottom and more content can load, trigger load more.
  // IntersectionObserver only fires on visibility *changes* — if user is at bottom from the start,
  // the sentinel may already be visible and no callback fires. Check on content updates AND on scroll.
  const BOTTOM_THRESHOLD = 250;
  const hasMoreCursor = activeFilter === "FAVORITES" ? favoritesCursor : cursor;
  const checkAtBottomAndLoad = useCallback(() => {
    if (loadingMore || displayItems.length === 0 || !hasMoreCursor) return;
    const scrollBottom = window.scrollY + window.innerHeight;
    const docBottom = document.documentElement.scrollHeight - BOTTOM_THRESHOLD;
    if (scrollBottom >= docBottom) loadMoreRef.current();
  }, [displayItems.length, hasMoreCursor, loadingMore]);

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

  // Resize (DevTools dock, window drag): IO can miss intersections; re-attach + bottom check.
  useEffect(() => {
    const onResize = () => {
      attachSentinelObserver();
      requestAnimationFrame(() => checkAtBottomAndLoad());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [attachSentinelObserver, checkAtBottomAndLoad]);

  // displayItems and displayTotal are hoisted above (near overlay nav computation)

  return (
    <>
      {/* Header */}
      <div className="mb-6 slide-up">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          onClick={() => {
            sessionStorage.setItem(`scroll_model_${model.folderName}`, String(window.scrollY));
          }}
        >
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
      <div className="flex items-center gap-2 mb-6 flex-wrap slide-up relative z-10" style={{ animationDelay: "0.15s" }}>
        <Button
          variant={activeFilter === "ALL" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("ALL")}
          disabled={isFiltering}
          className="gap-1.5"
        >
          {t("all")}
        </Button>
        <Button
          variant={activeFilter === "VIDEO" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("VIDEO")}
          disabled={isFiltering}
          className="gap-1.5"
        >
          <Film className="h-3.5 w-3.5" />
          {t("videos")}
        </Button>
        <Button
          variant={activeFilter === "PHOTO" ? "default" : "outline"}
          size="sm"
          onClick={() => handleFilterChange("PHOTO")}
          disabled={isFiltering}
          className="gap-1.5"
        >
          <Camera className="h-3.5 w-3.5" />
          {t("photos")}
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
            {t("favorite")}
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
            {{ newest: t("newest"), oldest: t("oldest"), longest: t("longest"), shortest: t("shortest") }[activeSort]}
          </Button>
          {sortMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} aria-hidden="true" />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-xl border border-white/[0.08] bg-card/95 backdrop-blur-xl p-1 shadow-2xl">
                {([
                  { value: "newest", label: t("newest"), icon: <Clock className="h-3.5 w-3.5" /> },
                  { value: "oldest", label: t("oldest"), icon: <Clock className="h-3.5 w-3.5" /> },
                  { value: "longest", label: t("longest"), icon: <Film className="h-3.5 w-3.5" /> },
                  { value: "shortest", label: t("shortest"), icon: <Film className="h-3.5 w-3.5" /> },
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
      {showEmptyState ? (
        <div className="text-center py-20 text-muted-foreground scale-in">
          {activeFilter === "FAVORITES" ? (
            <>
              <div className="mx-auto h-16 w-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-4">
                <Heart className="h-7 w-7 opacity-30" />
              </div>
              <p className="font-medium">{t("noFavoritesInFolder")}</p>
            </>
          ) : (
            <>
              <div className="mx-auto h-16 w-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mb-4">
                <Image className="h-7 w-7 opacity-30" />
              </div>
              <p className="font-medium">
                {activeFilter === "ALL"
                  ? t("noContentItems")
                  : activeFilter === "VIDEO" ? t("noVideosFound") : t("noPhotosFound")}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 sm:gap-5 items-start [grid-auto-rows:minmax(0,auto)]">
            {displayItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "cursor-pointer group text-left w-full min-h-0 max-w-full self-start overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 min-w-0",
                  index < 8 ? `animate-in fade-in stagger-${Math.min(index + 1, 8)}` : ""
                )}
                onClick={() => handleContentClick(item.id)}
                aria-label={item.contentType === "VIDEO" ? t("video") : t("photo")}
              >
                {/* aspect-ratio keeps tile height stable; h-0+padding+% could mis-measure under fast scroll + grid reflow */}
                <div className="relative isolate w-full aspect-[3/4] min-h-0 overflow-hidden rounded-xl bg-card border border-white/[0.12] shadow-sm shadow-black/30 card-hover group-hover:border-primary/30 transition-all duration-300">
                  {hasAccess ? (
                    <>
                      <LazyRetryImage
                        src={contentThumbnailSrc(item.id, item.thumbnailUrl)}
                        fallbackSrc={contentThumbnailProxySrc(item.id)}
                        alt={item.contentType === "VIDEO" ? t("video") : t("photo")}
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.06]"
                        rootMargin="1200px"
                        priority={index < 6}
                        placeholder={
                          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted/60 via-muted/40 to-secondary/50 animate-pulse">
                            {item.contentType === "VIDEO" ? (
                              <Play className="h-8 w-8 text-muted-foreground/40" />
                            ) : (
                              <Image className="h-8 w-8 text-muted-foreground/40" />
                            )}
                          </div>
                        }
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
                        type="button"
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded-lg bg-black/30 backdrop-blur-sm hover:bg-black/50 transition-all cursor-pointer"
                        onClick={(e) => toggleFavorite(e, item.id)}
                        disabled={togglingFav === item.id}
                        aria-label={favoritedIds.has(item.id) ? t("favorited") : t("favorite")}
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
              </button>
            ))}
          </div>

          <div key={`sentinel-${activeFilter}-${activeSort}`} ref={sentinelCallbackRef} className="flex justify-center py-8">
            {loadingMore && (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
            {!loadingMore && !hasMoreCursor && displayItems.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {displayItems.length} of {displayTotal} items
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Fullscreen overlay → document.body so position:fixed is never trapped by ancestor transform/filter ── */}
      {overlayPortalReady &&
        selectedItemId &&
        selectedItem &&
        createPortal(
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-sm flex flex-col"
          // Fix #6: Mobile swipe support
          onTouchStart={(e) => {
            const touch = e.touches[0];
            const target = e.target as HTMLElement;
            (overlayRef.current as any).__touchStartX = touch.clientX;
            (overlayRef.current as any).__touchStartY = touch.clientY;
            (overlayRef.current as any).__touchStartTarget = target;
          }}
          onTouchEnd={(e) => {
            const el = overlayRef.current as any;
            if (!el?.__touchStartX) return;
            // Don't trigger swipe if touch started on controls (progress bar, play, seek)
            const startTarget = el.__touchStartTarget as HTMLElement | undefined;
            if (startTarget?.closest?.("[data-controls]")) return;
            const dx = e.changedTouches[0].clientX - el.__touchStartX;
            const dy = Math.abs(e.changedTouches[0].clientY - el.__touchStartY);
            if (Math.abs(dx) < 50 || dy > Math.abs(dx)) return;
            if (dx < 0) {
              if (overlayNextId) navigateToOverlayItem(overlayNextId, "swipe");
              else if (cursor || favoritesCursor) {
                pendingNextAfterLoadRef.current = true;
                triggerLoadMoreForNav();
              }
            } else if (dx > 0 && overlayPrevId) navigateToOverlayItem(overlayPrevId, "swipe");
          }}
        >
          {/* Overlay top bar */}
          <div className="flex items-center justify-between px-4 py-3 lg:px-6 shrink-0">
            <button
              onClick={closeOverlay}
              className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("backToModel", { modelName: model.name })}</span>
              <span className="sm:hidden">Back</span>
            </button>

            <div className="flex items-center gap-1.5 lg:gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => overlayPrevId && navigateToOverlayItem(overlayPrevId, "prev")}
                disabled={!overlayPrevId}
                className="h-8 w-8 lg:h-10 lg:w-10 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
              >
                <ChevronLeft className="h-4 w-4 lg:h-5 lg:w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (overlayNextId) navigateToOverlayItem(overlayNextId, "next");
                  else if (cursor || favoritesCursor) {
                    pendingNextAfterLoadRef.current = true;
                    triggerLoadMoreForNav();
                  }
                }}
                disabled={!overlayNextId && !(cursor || favoritesCursor)}
                className="h-8 w-8 lg:h-10 lg:w-10 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
              >
                {!overlayNextId && (cursor || favoritesCursor) && loadingMore ? (
                  <Loader2 className="h-4 w-4 lg:h-5 lg:w-5 animate-spin" />
                ) : (
                  <ChevronRight className="h-4 w-4 lg:h-5 lg:w-5" />
                )}
              </Button>

              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOverlayFolderMenuOpen((o) => !o)}
                  disabled={overlayContextLoading}
                  aria-expanded={overlayFolderMenuOpen}
                  aria-haspopup="dialog"
                  aria-label={t("overlayFolderView")}
                  className="h-8 w-8 lg:h-10 lg:w-10 rounded-lg text-white/70 hover:text-white hover:bg-white/10 shrink-0"
                >
                  {overlayContextLoading ? (
                    <Loader2 className="h-4 w-4 lg:h-5 lg:w-5 animate-spin" />
                  ) : (
                    <LayoutGrid className="h-4 w-4 lg:h-5 lg:w-5" />
                  )}
                </Button>
                {overlayFolderMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-[205]"
                      aria-hidden
                      onClick={() => setOverlayFolderMenuOpen(false)}
                    />
                    <div
                      className="absolute right-0 top-full mt-1.5 z-[210] w-[min(calc(100vw-1.5rem),17rem)] rounded-xl border border-white/[0.1] bg-zinc-950/95 backdrop-blur-md py-2 shadow-xl"
                      role="dialog"
                      aria-label={t("overlayFolderView")}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-wrap gap-1 px-2">
                        <button
                          type="button"
                          onClick={() => void applyOverlayFilterChange("ALL")}
                          disabled={overlayContextLoading}
                          className={cn(
                            "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            activeFilter === "ALL"
                              ? "bg-white/15 text-white"
                              : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                          )}
                        >
                          {t("all")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void applyOverlayFilterChange("VIDEO")}
                          disabled={overlayContextLoading}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            activeFilter === "VIDEO"
                              ? "bg-white/15 text-white"
                              : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                          )}
                        >
                          <Film className="h-3 w-3 shrink-0 opacity-80" />
                          {t("videos")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void applyOverlayFilterChange("PHOTO")}
                          disabled={overlayContextLoading}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            activeFilter === "PHOTO"
                              ? "bg-white/15 text-white"
                              : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                          )}
                        >
                          <Camera className="h-3 w-3 shrink-0 opacity-80" />
                          {t("photos")}
                        </button>
                        {isAuthenticated && hasAccess && (
                          <button
                            type="button"
                            onClick={() => void applyOverlayFilterChange("FAVORITES")}
                            disabled={overlayContextLoading}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                              activeFilter === "FAVORITES"
                                ? "bg-white/15 text-white"
                                : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                            )}
                          >
                            <Heart
                              className={cn(
                                "h-3 w-3 shrink-0 opacity-80",
                                activeFilter === "FAVORITES" && "fill-red-400 text-red-400",
                              )}
                            />
                            {t("favorite")}
                          </button>
                        )}
                      </div>
                      <div className="mt-2 border-t border-white/[0.06] pt-2 px-2 space-y-0.5">
                        {([
                          { value: "newest" as const, label: t("newest") },
                          { value: "oldest" as const, label: t("oldest") },
                          { value: "longest" as const, label: t("longest") },
                          { value: "shortest" as const, label: t("shortest") },
                        ]).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => void applyOverlaySortChange(opt.value)}
                            disabled={overlayContextLoading}
                            className={cn(
                              "flex w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors cursor-pointer",
                              activeSort === opt.value
                                ? "bg-white/12 text-white font-medium"
                                : "text-white/50 hover:bg-white/[0.05] hover:text-white/90",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="w-px h-5 bg-white/10 mx-1 hidden sm:block" />

              <Button
                variant="ghost"
                size="sm"
                onClick={overlayToggleFavorite}
                disabled={overlayTogglingFav}
                className="gap-1.5 text-white/70 hover:text-white hover:bg-white/10 lg:h-10 lg:px-3"
              >
                <Heart
                  className={cn(
                    "h-4 w-4 lg:h-5 lg:w-5 transition-all",
                    overlayFavorited ? "fill-red-500 text-red-500 scale-110" : ""
                  )}
                />
                <span className="hidden sm:inline">
                  {overlayFavorited ? t("favorited") : t("favorite")}
                </span>
              </Button>

              {isAdmin && (
                <>
                  <div className="w-px h-5 bg-white/10 mx-1 hidden sm:block" />
                  <a
                    href={resolveApiPathForBrowser(
                      `/api/admin/content/${selectedItemId}/source-download`
                    )}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "gap-1.5 text-white/70 hover:text-white hover:bg-white/10 no-underline lg:h-10 lg:px-3"
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="h-4 w-4 lg:h-5 lg:w-5 shrink-0" />
                    <span className="hidden sm:inline">{t("downloadContent")}</span>
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDeleteContent}
                    disabled={overlayDeleting}
                    className="gap-1.5 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 lg:h-10 lg:px-3"
                  >
                    {overlayDeleting ? (
                      <Loader2 className="h-4 w-4 lg:h-5 lg:w-5 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 lg:h-5 lg:w-5" />
                    )}
                    <span className="hidden sm:inline">{t("deleteContent")}</span>
                  </Button>
                </>
              )}

              <div className="w-px h-5 bg-white/10 mx-1 hidden sm:block" />

              <Button
                variant="ghost"
                size="icon"
                onClick={closeOverlay}
                className="h-8 w-8 lg:h-10 lg:w-10 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
              >
                <X className="h-4 w-4 lg:h-5 lg:w-5" />
              </Button>
            </div>
          </div>

          {/* Content area — click on backdrop (outside media) closes overlay */}
          <div
            className="flex-1 flex items-center justify-center overflow-y-auto overflow-x-hidden px-3 pb-3 sm:px-4 sm:pb-4 lg:px-6 lg:pb-5 cursor-pointer min-w-0 scrollbar-hide"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest("[data-video-player], img, button")) return;
              closeOverlay();
            }}
          >
            <div
              className="relative rounded-xl sm:rounded-2xl overflow-hidden bg-black flex items-center justify-center w-full max-w-6xl lg:max-w-7xl xl:max-w-[min(1680px,94vw)] cursor-default min-w-0 shrink"
              onClick={(e) => e.stopPropagation()}
            >
              {selectedItem.contentType === "VIDEO" ? (
                <div className="w-full min-w-0 shrink">
                  {/* Fix #3 (real): No key prop — React keeps VideoPlayer mounted between video changes.
                    The HLS useEffect re-initializes on contentItemId change without unmounting the
                    container. This preserves the browser's native fullscreen state. */}
                  <VideoPlayer
                    contentItemId={selectedItemId}
                    modelId={model.id}
                    folderName={model.folderName}
                    galleryOverlay
                  />
                </div>
              ) : (
                <RetryImage
                  src={contentThumbnailSrc(selectedItemId, selectedItem.thumbnailUrl)}
                  fallbackSrc={contentThumbnailProxySrc(selectedItemId)}
                  alt=""
                  className="max-h-[85vh] max-w-full w-auto mx-auto object-contain lg:max-h-[min(90dvh,1020px)]"
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
                  fallback={
                    <div className="flex flex-col items-center justify-center gap-3 py-16 px-8 text-white/50">
                      <Image className="h-16 w-16 opacity-40" />
                      <span className="text-sm">{t("imageLoadFailed")}</span>
                    </div>
                  }
                />
              )}
            </div>
          </div>

          {filmstripSlice.items.length > 0 && (
            <div
              className="shrink-0 px-2 sm:px-4 lg:px-6 pb-2 lg:pb-3 border-t border-white/[0.06] pt-2 lg:pt-3"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="navigation"
              aria-label={t("overlayGalleryStrip")}
            >
              <div className="flex gap-2 sm:gap-2.5 lg:gap-3 justify-start lg:justify-center overflow-x-auto py-1 lg:py-1.5 scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] snap-x snap-mandatory max-w-full mx-auto">
                {filmstripSlice.items.map((item, i) => {
                  const active = i === filmstripSlice.activeOffset;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      ref={active ? filmstripActiveRef : undefined}
                      onClick={() => {
                        if (item.id !== selectedItemId) {
                          navigateToOverlayItem(item.id, "strip");
                        }
                      }}
                      className={cn(
                        "relative shrink-0 snap-center rounded-md lg:rounded-lg overflow-hidden transition-[opacity,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/35",
                        active
                          ? "ring-2 ring-primary ring-offset-0 opacity-100"
                          : "opacity-55 hover:opacity-90",
                      )}
                      aria-current={active ? "true" : undefined}
                      aria-label={
                        item.contentType === "VIDEO" ? t("video") : t("photo")
                      }
                    >
                      <div className="h-12 w-[2.6rem] sm:h-16 sm:w-12 lg:h-[5.25rem] lg:w-[4.15rem] xl:h-[5.75rem] xl:w-[4.5rem] bg-black/60">
                        <LazyRetryImage
                          src={contentThumbnailSrc(item.id, item.thumbnailUrl)}
                          fallbackSrc={contentThumbnailProxySrc(item.id)}
                          alt=""
                          className="h-full w-full object-cover"
                          rootMargin="80px"
                          placeholder={
                            <div className="h-full w-full bg-white/[0.04] animate-pulse" />
                          }
                          fallback={
                            <div className="h-full w-full flex items-center justify-center bg-white/[0.06]">
                              {item.contentType === "VIDEO" ? (
                                <Play className="h-4 w-4 lg:h-6 lg:w-6 text-white/25" />
                              ) : (
                                <Image className="h-4 w-4 lg:h-6 lg:w-6 text-white/25" />
                              )}
                            </div>
                          }
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-center text-xs text-white/30 pb-3">
            <span className="hidden sm:inline">
              {selectedItem.contentType === "VIDEO"
                ? t("shiftArrowsToNavigate")
                : t("arrowsToNavigate")}
            </span>
            <span className="sm:hidden">{t("swipeToNavigate")}</span>
          </p>
        </div>,
        document.body
        )}

    </>
  );
}
