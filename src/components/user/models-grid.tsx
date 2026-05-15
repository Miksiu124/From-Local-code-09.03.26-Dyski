"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, memo } from "react";
import { CatalogNavLink } from "@/components/user/catalog-nav-link";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Unlock, Search, Crown, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessRequiredPopup } from "@/components/access-required-popup";
import { cn } from "@/lib/utils";
import {
  trackCatalogHomeViewed,
  trackCatalogFilterUsed,
  trackSearchUsed,
  trackCatalogModelImpression,
  trackCatalogModelEngagedImpression,
  trackCatalogModelClick,
  type CatalogModelSurface,
} from "@/lib/growth-analytics";
import { getGrowthTabSessionId } from "@/lib/growth-events";
import { tryConsumeCatalogImpressionSlot } from "@/lib/catalog-impression-dedupe";
import { tryConsumeCatalogEngagedSlot } from "@/lib/catalog-engaged-dedupe";
import { modelHeaderViewTransitionName, modelThumbViewTransitionName } from "@/lib/model-view-transition";
import { NextImageWithFallback } from "@/components/ui/next-image-with-fallback";

interface ModelItem {
  id: string;
  name: string;
  folderName: string;
  description: string | null;
  countryId: string | null;
  countryName: string | null;
  countryFlag: string | null;
  contentCount: number;
  videoCount?: number;
  imageCount?: number;
  isActive: boolean;
  firstContentItemId: string | null;
  avatarUrl?: string;
  headerUrl?: string;
}

interface CountryItem {
  id: string;
  name: string;
  code: string;
  flagEmoji: string | null;
}

interface ModelsGridProps {
  initialModels: ModelItem[];
  featuredModels: ModelItem[];
  initialCursor: string | null;
  totalModelCount: number;
  countries: CountryItem[];
  cost7d: number;
  cost30d: number;
  bundleCost14d: number;
  bundleCost30d: number;
  userAccessModelIds: string[] | "all";
  isAuthenticated: boolean;
  creditBalance: number;
}

/** Visibility → catalog_model_impression (once per browser tab per model_id). */
function CatalogModelSurfaceTracker({
  modelId,
  folderName,
  surface,
  gridIndex,
  queryLen,
  countryId,
  purchasedOnly,
  children,
  className,
}: {
  modelId: string;
  folderName: string;
  surface: CatalogModelSurface;
  gridIndex: number;
  queryLen: number;
  countryId: string | null;
  purchasedOnly: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const base = {
      surface,
      grid_index: gridIndex,
      query_len: queryLen,
      purchased_only: purchasedOnly,
      country_id: countryId ?? undefined,
      tab_session: getGrowthTabSessionId(),
    };
    let impressionSent = false;
    let engagedDone = false;
    let visible = false;
    let engagedTimer: ReturnType<typeof setTimeout> | null = null;

    const clearEngagedTimer = () => {
      if (engagedTimer) {
        clearTimeout(engagedTimer);
        engagedTimer = null;
      }
    };

    const scheduleEngaged = () => {
      clearEngagedTimer();
      engagedTimer = setTimeout(() => {
        engagedTimer = null;
        if (!visible || engagedDone) return;
        if (!tryConsumeCatalogEngagedSlot(modelId)) {
          engagedDone = true;
          return;
        }
        engagedDone = true;
        trackCatalogModelEngagedImpression(modelId, folderName, base);
      }, 900);
    };

    const obs = new IntersectionObserver(
      (entries) => {
        const ent = entries[0];
        visible = !!ent?.isIntersecting;
        if (!visible) {
          clearEngagedTimer();
          return;
        }
        if (!impressionSent) {
          if (!tryConsumeCatalogImpressionSlot(modelId)) {
            obs.disconnect();
            return;
          }
          impressionSent = true;
          trackCatalogModelImpression(modelId, folderName, base);
        }
        if (!engagedDone) scheduleEngaged();
      },
      { threshold: 0.38, rootMargin: "0px" },
    );
    obs.observe(el);
    return () => {
      clearEngagedTimer();
      obs.disconnect();
    };
  }, [modelId, folderName, surface, gridIndex, queryLen, countryId, purchasedOnly]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Memoized card to avoid re-renders when parent state changes (e.g. search typing) */
const ModelCard = memo(function ModelCard({
  model,
  hasAccess,
  cost7d,
  t,
  onModelClick,
  imagePriority = false,
}: {
  model: ModelItem;
  hasAccess: (id: string) => boolean;
  cost7d: number;
  t: ReturnType<typeof useTranslations>;
  onModelClick: (model: ModelItem, e: React.MouseEvent) => void;
  imagePriority?: boolean;
}) {
  const thumbSrc = model.avatarUrl || `/api/models/${model.folderName}/thumbnail`;
  return (
    <CatalogNavLink
      href={`/models/${model.folderName}`}
      onClick={(e) => onModelClick(model, e)}
      prefetch={false}
      className="group block h-full min-w-0"
    >
        <div
          className="catalog-contact-card relative aspect-[3/4] overflow-hidden rounded-lg border border-white/[0.07] bg-card transition-colors duration-300 group-hover:border-[oklch(0.58_0.08_42_/_0.45)]"
          style={{ viewTransitionName: modelThumbViewTransitionName(model.id) }}
        >
          <NextImageWithFallback
            src={thumbSrc}
            alt={model.name}
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]"
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
            loading={imagePriority ? "eager" : "lazy"}
            priority={imagePriority}
            quality={72}
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-[oklch(0.16_0.018_28)]">
                <span className="text-4xl font-bold text-muted-foreground/30">
                  {model.name.charAt(0).toUpperCase()}
                </span>
              </div>
            }
          />
          <div className="catalog-contact-fade absolute inset-0" />
          <div className="absolute inset-0 bg-[oklch(0.08_0.012_28_/_0.12)] transition-colors duration-500 group-hover:bg-transparent" />
          <div className="absolute top-2.5 right-2.5">
            {hasAccess(model.id) ? (
              <div className="rounded-md border border-success/30 bg-success/18 p-1.5 text-success">
                <Unlock className="h-3 w-3" aria-hidden />
              </div>
            ) : (
              <div className="rounded-md border border-white/[0.08] bg-[oklch(0.1_0.012_28_/_0.62)] p-1.5 text-white/55">
                <Lock className="h-3 w-3" aria-hidden />
              </div>
            )}
          </div>
          {model.countryFlag && (
            <div className="absolute top-2.5 left-2.5">
              <span className="text-lg drop-shadow-md">{model.countryFlag}</span>
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-bold text-white truncate">{model.name}</h3>
            <div className="flex items-center justify-between mt-1.5 gap-1">
              <span className="text-[9px] sm:text-xs font-medium text-white/50 leading-snug line-clamp-2 min-w-0">
                {model.videoCount != null && model.imageCount != null && (model.videoCount > 0 || model.imageCount > 0)
                  ? t("videosPhotosCount", { videoCount: model.videoCount, imageCount: model.imageCount })
                  : `${model.contentCount} ${t("items")}`}
              </span>
              {!hasAccess(model.id) && cost7d > 0 && (
                <span className="rounded-sm bg-[oklch(0.74_0.13_48)] px-2 py-0.5 text-[10px] font-semibold text-[oklch(0.12_0.018_28)] sm:text-xs">
                  {t("getAccess")}
                </span>
              )}
            </div>
          </div>
        </div>
    </CatalogNavLink>
  );
});

export function ModelsGrid({
  initialModels,
  featuredModels,
  initialCursor,
  totalModelCount,
  countries,
  cost7d,
  cost30d,
  bundleCost14d,
  bundleCost30d,
  userAccessModelIds,
  isAuthenticated,
  creditBalance,
}: ModelsGridProps) {
  const t = useTranslations("models");

  useEffect(() => {
    try {
      if (sessionStorage.getItem("gf_catalog_home_viewed")) return;
      sessionStorage.setItem("gf_catalog_home_viewed", "1");
      trackCatalogHomeViewed();
    } catch {
      trackCatalogHomeViewed();
    }
  }, []);

  /** SSR-safe defaults; session restore runs in useLayoutEffect before paint to avoid hydration mismatch + wiping storage. */
  const [models, setModels] = useState<ModelItem[]>(initialModels);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupModelId, setPopupModelId] = useState<string | undefined>();
  const [popupModelName, setPopupModelName] = useState<string | undefined>();
  const [popupModelSlug, setPopupModelSlug] = useState<string | undefined>();
  const [popupIsBundle, setPopupIsBundle] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(initialModels.length > 0);

  const [activeIndex, setActiveIndex] = useState(0);

  const [filteredMode, setFilteredMode] = useState(false);
  const [showPurchasedOnly, setShowPurchasedOnly] = useState(false);
  const [catalogHydrated, setCatalogHydrated] = useState(false);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawSearch = sessionStorage.getItem("models_search");
      const searchVal = rawSearch != null ? String(rawSearch).slice(0, 500) : "";
      const rawCountry = sessionStorage.getItem("models_country");
      const countryVal = rawCountry && rawCountry.length <= 64 ? rawCountry : null;
      if (sessionStorage.getItem("models_purchased_only") === "1") {
        setShowPurchasedOnly(true);
      }
      if (searchVal || countryVal) {
        setSearch(searchVal);
        setSelectedCountry(countryVal);
        setModels([]);
        setCursor(null);
        setFilteredMode(true);
      }
    } catch {
      // storage blocked
    } finally {
      setCatalogHydrated(true);
    }
  }, []);

  // Persist folder search state (same logic as filter/sort in model folders)
  useEffect(() => {
    if (typeof window === "undefined" || !catalogHydrated) return;
    sessionStorage.setItem("models_search", search.slice(0, 500));
  }, [search, catalogHydrated]);
  useEffect(() => {
    if (typeof window === "undefined" || !catalogHydrated) return;
    if (selectedCountry) sessionStorage.setItem("models_country", selectedCountry);
    else sessionStorage.removeItem("models_country");
  }, [selectedCountry, catalogHydrated]);
  useEffect(() => {
    if (typeof window === "undefined" || !catalogHydrated) return;
    sessionStorage.setItem("models_purchased_only", showPurchasedOnly ? "1" : "0");
  }, [showPurchasedOnly, catalogHydrated]);

  // Fix #1: Scroll Restoration — restore scroll before first paint (useLayoutEffect)
  // Same as folder exit: instant, no visible jump from top
  const savedScrollTargetRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const saved = sessionStorage.getItem("models_scroll_y");
    if (saved) {
      sessionStorage.removeItem("models_scroll_y");
      const target = parseInt(saved, 10);
      if (!Number.isNaN(target) && target >= 0) {
        savedScrollTargetRef.current = target;
        window.scrollTo({ top: target, behavior: "instant" });
      }
    }
  }, []);

  // When content grows (load more), re-apply scroll before paint
  useLayoutEffect(() => {
    const target = savedScrollTargetRef.current;
    if (target === null || loading) return;
    if (filteredMode && models.length === 0) return;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll >= target) {
      window.scrollTo({ top: target, behavior: "instant" });
      savedScrollTargetRef.current = null;
    } else if (cursor) {
      loadMoreRef.current();
    } else {
      window.scrollTo({ top: maxScroll, behavior: "instant" });
      savedScrollTargetRef.current = null;
    }
  }, [models.length, loading, cursor, filteredMode]);

  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const searchQueriesEmittedRef = useRef<Set<string>>(new Set());
  const countryEmittedRef = useRef<string | null>(null);

  const displayFeatured = featuredModels.length > 0 ? featuredModels : initialModels.slice(0, 6);

  useEffect(() => {
    if (displayFeatured.length <= 1) return;
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % displayFeatured.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [displayFeatured.length]);

  const heroModel = displayFeatured.length > 0 ? displayFeatured[activeIndex] : null;

  const sideModels = displayFeatured.length > 0
    ? Array.from({ length: Math.min(3, displayFeatured.length - 1) }).map((_, i) => displayFeatured[(activeIndex + 1 + i) % displayFeatured.length])
    : [];

  const goNext = () => setActiveIndex((prev) => (prev + 1) % displayFeatured.length);
  const goPrev = () => setActiveIndex((prev) => (prev - 1 + displayFeatured.length) % displayFeatured.length);

  const fetchModels = useCallback(
    async (opts: { cursor?: string; search?: string; country?: string; reset?: boolean; signal?: AbortSignal }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (opts.cursor) params.set("cursor", opts.cursor);
        params.set("limit", "20");
        if (opts.search) params.set("search", opts.search);
        if (opts.country) params.set("country", opts.country);

        const ac = new AbortController();
        const timeoutId = setTimeout(() => ac.abort(), 25_000);
        if (opts.signal) {
          if (opts.signal.aborted) ac.abort();
          else opts.signal.addEventListener("abort", () => ac.abort(), { once: true });
        }
        let res: Response;
        try {
          res = await fetch(`/api/models?${params.toString()}`, { signal: ac.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok) return;

        const data = await res.json();
        if (opts.reset) {
          setModels(data.models ?? []);
        } else {
          setModels((prev) => {
            const ids = new Set(prev.map((m) => m.id));
            const newOnes = (data.models ?? []).filter((m: ModelItem) => !ids.has(m.id));
            return [...prev, ...newOnes];
          });
        }
        setCursor(data.nextCursor ?? null);

        if (opts.reset) {
          if (opts.search && opts.search.trim().length >= 2) {
            const q = opts.search.trim().toLowerCase();
            if (!searchQueriesEmittedRef.current.has(q)) {
              searchQueriesEmittedRef.current.add(q);
              trackSearchUsed({ surface: "catalog_home", query_len: q.length });
            }
          }
          if (opts.country) {
            if (countryEmittedRef.current !== opts.country) {
              countryEmittedRef.current = opts.country;
              trackCatalogFilterUsed({ surface: "catalog_home", kind: "country" });
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const hasFetchedFilteredRef = useRef(false);
  useEffect(() => {
    if (!catalogHydrated) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    abortControllerRef.current?.abort();

    if (!search && !selectedCountry) {
      hasFetchedFilteredRef.current = false;
      if (initialModels.length > 0) {
        setFilteredMode(false);
        setModels(initialModels);
        setCursor(initialCursor);
      }
      return;
    }

    setFilteredMode(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const doFetch = () => {
      fetchModels({
        search: search || undefined,
        country: selectedCountry || undefined,
        reset: true,
        signal: controller.signal,
      });
    };

    const isInitialWithFilters = !hasFetchedFilteredRef.current;
    if (isInitialWithFilters) hasFetchedFilteredRef.current = true;
    searchTimerRef.current = setTimeout(doFetch, isInitialWithFilters ? 0 : 150);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      controller.abort();
      abortControllerRef.current = null;
    };
  }, [catalogHydrated, search, selectedCountry, fetchModels, initialModels, initialCursor]);

  useEffect(() => {
    if (!catalogHydrated) return;
    if (initialLoaded || initialModels.length > 0) return;
    if (search || selectedCountry) return;
    setInitialLoaded(true);
    fetchModels({ reset: true });
  }, [catalogHydrated, initialLoaded, initialModels.length, fetchModels, search, selectedCountry]);

  const loadMoreRef = useRef<() => void>(() => { });
  loadMoreRef.current = () => {
    if (loading || !cursor) return;
    fetchModels({
      cursor,
      search: search || undefined,
      country: selectedCountry || undefined,
    });
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

  // Fix: When scroll is already at bottom and more models can load, trigger load more.
  // IntersectionObserver only fires on visibility *changes* — if user is at bottom from the start,
  // the sentinel may already be visible and no callback fires. Check on content updates AND on scroll.
  const BOTTOM_THRESHOLD = 250;
  const checkAtBottomAndLoad = useCallback(() => {
    if (loading || !cursor || models.length === 0) return;
    const scrollBottom = window.scrollY + window.innerHeight;
    const docBottom = document.documentElement.scrollHeight - BOTTOM_THRESHOLD;
    if (scrollBottom >= docBottom) loadMoreRef.current();
  }, [models.length, cursor, loading]);

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

  const hasAccess = useCallback((modelId: string) => {
    if (userAccessModelIds === "all") return true;
    return userAccessModelIds.includes(modelId);
  }, [userAccessModelIds]);

  const handleModelClick = useCallback(
    (model: ModelItem, e: React.MouseEvent, surface: CatalogModelSurface, gridIndex: number) => {
      trackCatalogModelClick(model.id, model.folderName, {
        surface,
        grid_index: gridIndex,
        query_len: search.trim().length,
        country_id: selectedCountry ?? undefined,
        purchased_only: showPurchasedOnly,
        outcome: hasAccess(model.id) ? "open" : "login_required",
        tab_session: getGrowthTabSessionId(),
      });
      if (!hasAccess(model.id)) {
        e.preventDefault();
        setPopupIsBundle(false);
        setPopupModelId(model.id);
        setPopupModelName(model.name);
        setPopupModelSlug(model.folderName);
        setPopupOpen(true);
      } else {
        sessionStorage.setItem("models_scroll_y", String(window.scrollY));
      }
    },
    [hasAccess, search, selectedCountry, showPurchasedOnly],
  );

  const openBundlePopup = () => {
    setPopupIsBundle(true);
    setPopupModelId(undefined);
    setPopupModelName(undefined);
    setPopupModelSlug(undefined);
    setPopupOpen(true);
  };

  const [clientCountries, setClientCountries] = useState<CountryItem[]>(countries);

  useEffect(() => {
    if (countries.length > 0) return;
    fetch("/api/countries")
      .then((res) => res.ok ? res.json() : [])
      .then((data: CountryItem[]) => {
        if (Array.isArray(data) && data.length > 0) setClientCountries(data);
      })
      .catch(() => { });
  }, [countries.length]);

  const countriesWithModels = clientCountries;

  const displayModels = showPurchasedOnly
    ? models.filter((m) => hasAccess(m.id))
    : models;

  const hasActiveFilters =
    search.trim().length > 0 || selectedCountry !== null || showPurchasedOnly;
  const activeCountryName = selectedCountry
    ? countriesWithModels.find((country) => country.id === selectedCountry)?.name ?? null
    : null;

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setSelectedCountry(null);
    setShowPurchasedOnly(false);
    hasFetchedFilteredRef.current = false;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("models_search");
      sessionStorage.removeItem("models_country");
      sessionStorage.removeItem("models_purchased_only");
    }
    if (initialModels.length > 0) {
      setFilteredMode(false);
      setModels(initialModels);
      setCursor(initialCursor);
    }
  }, [initialCursor, initialModels]);

  return (
    <>
      {/* Featured Section */}
      {!filteredMode && heroModel && (
        <section className="catalog-contact-section mb-10 slide-up" style={{ animationDelay: "0.1s" }}>
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-sm font-semibold text-foreground/78">
              {t("featured")}
            </h2>
            {displayFeatured.length > 1 && (
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={goPrev} className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-lg border border-white/[0.07] bg-[oklch(0.13_0.014_28)] transition-colors hover:bg-[oklch(0.17_0.018_28)] touch-manipulation" aria-label={t("carouselPrev")}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" onClick={goNext} className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-lg border border-white/[0.07] bg-[oklch(0.13_0.014_28)] transition-colors hover:bg-[oklch(0.17_0.018_28)] touch-manipulation" aria-label={t("carouselNext")}>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 lg:h-[460px] lg:grid-cols-[minmax(0,1.72fr)_minmax(280px,0.68fr)]">
            {/* Main Hero Card — aspect-video prevents empty stretched tile before image loads */}
            <CatalogModelSurfaceTracker
              key={heroModel.id}
              modelId={heroModel.id}
              folderName={heroModel.folderName}
              surface="featured_hero"
              gridIndex={activeIndex}
              queryLen={search.trim().length}
              countryId={selectedCountry}
              purchasedOnly={showPurchasedOnly}
              className="catalog-hero-frame relative min-h-[220px] w-full overflow-hidden rounded-xl border border-white/[0.08] bg-card aspect-video lg:h-full lg:min-h-0 lg:aspect-auto"
            >
              <div className="absolute inset-0 bg-[linear-gradient(135deg,oklch(0.19_0.02_28),oklch(0.12_0.014_28))] animate-pulse lg:animate-none" aria-hidden />
              <CatalogNavLink
                href={`/models/${heroModel.folderName}`}
                onClick={(e) => handleModelClick(heroModel, e, "featured_hero", activeIndex)}
                prefetch={false}
                className="absolute inset-0 z-[1]"
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={heroModel.id}
                    initial={{ opacity: 0, scale: 1.025 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-0"
                    style={{ viewTransitionName: modelHeaderViewTransitionName(heroModel.id) }}
                  >
                    <NextImageWithFallback
                      src={heroModel.headerUrl || `/api/models/${heroModel.folderName}/header`}
                      alt={heroModel.name}
                      className="object-cover"
                      fill
                      sizes="(max-width: 1024px) 100vw, 800px"
                      quality={78}
                      priority
                      loading="eager"
                    />
                  </motion.div>
                </AnimatePresence>
                <div className="catalog-hero-vignette pointer-events-none absolute inset-0 z-[2]" aria-hidden />
                <div className="catalog-hero-rake pointer-events-none absolute inset-0 z-[2]" />

                <div className="absolute bottom-0 left-0 z-[3] w-full p-5 sm:p-7">
                  <div className="mb-3">
                    <Badge className="rounded-md border border-white/[0.08] bg-[oklch(0.74_0.13_48)] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[oklch(0.12_0.018_28)]">
                      {t("featured")}
                    </Badge>
                  </div>
                  <h3 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-2 tracking-tight leading-[1.12]">
                    {heroModel.name}
                  </h3>
                  <p className="text-white/60 line-clamp-2 max-w-lg text-sm sm:text-base mb-4">
                    {heroModel.description || t("exclusiveContent", { name: heroModel.name })}
                  </p>
                  <div className="flex items-center gap-4 text-xs sm:text-sm text-white/70">
                    <span>
                      {heroModel.videoCount != null && heroModel.imageCount != null && (heroModel.videoCount > 0 || heroModel.imageCount > 0)
                        ? t("videosPhotosCount", { videoCount: heroModel.videoCount, imageCount: heroModel.imageCount })
                        : `${heroModel.contentCount} ${t("items")}`}
                    </span>
                    <span className="text-white/30">|</span>
                    <span>{heroModel.countryName} {heroModel.countryFlag}</span>
                  </div>
                </div>

                {/* Carousel indicators */}
                {displayFeatured.length > 1 && (
                  <div className="pointer-events-auto absolute bottom-5 right-5 z-[4] flex items-center gap-0.5 sm:bottom-7 sm:right-7">
                    {displayFeatured.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveIndex(i); }}
                        className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 touch-manipulation"
                        aria-label={t("carouselSlide", { current: i + 1, total: displayFeatured.length })}
                        aria-current={i === activeIndex ? "true" : undefined}
                      >
                        <span
                          className={cn(
                            "block rounded-full transition-all duration-300",
                            i === activeIndex ? "h-1.5 w-6 bg-[oklch(0.92_0.02_48)]" : "h-1.5 w-1.5 bg-white/30 hover:bg-white/50"
                          )}
                          aria-hidden
                        />
                      </button>
                    ))}
                  </div>
                )}
              </CatalogNavLink>
            </CatalogModelSurfaceTracker>

            {/* Side List */}
            <div className="-mx-4 flex flex-row gap-2 overflow-x-auto overscroll-x-contain px-4 pb-2 scrollbar-hide snap-x snap-mandatory lg:mx-0 lg:flex-col lg:px-0 lg:pb-0 lg:snap-none">
              {sideModels.map((model, idx) => (
                <CatalogModelSurfaceTracker
                  key={model.id}
                  modelId={model.id}
                  folderName={model.folderName}
                  surface="featured_side"
                  gridIndex={idx}
                  queryLen={search.trim().length}
                  countryId={selectedCountry}
                  purchasedOnly={showPurchasedOnly}
                  className="catalog-strip-frame group relative flex-1 w-[248px] flex-shrink-0 snap-start overflow-hidden rounded-lg border border-white/[0.07] bg-card transition-colors duration-300 hover:border-[oklch(0.58_0.08_42_/_0.38)] lg:w-auto"
                >
                <CatalogNavLink
                  href={`/models/${model.folderName}`}
                  onClick={(e) => handleModelClick(model, e, "featured_side", idx)}
                  prefetch={false}
                  className="group block h-full min-h-[100px]"
                >
                  <div className="flex h-full min-h-[100px]">
                    {/* No viewTransitionName here: same model also appears in the grid below → duplicate name breaks View Transitions API */}
                    <div className="w-24 lg:w-1/3 relative shrink-0 min-h-[100px]">
                      <NextImageWithFallback
                        src={model.avatarUrl || `/api/models/${model.folderName}/thumbnail`}
                        alt={model.name}
                        className="object-cover"
                        fill
                        sizes="(max-width: 1023px) 96px, 20vw"
                        quality={70}
                        fallback={
                          <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground/50 text-2xl font-bold">
                            {model.name.charAt(0).toUpperCase()}
                          </div>
                        }
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,oklch(0.14_0.018_28))]" />
                    </div>
                    <div className="flex flex-1 flex-col justify-center p-4">
                      <h4 className="truncate text-sm font-bold text-white transition-colors group-hover:text-[oklch(0.84_0.07_48)] lg:text-base">{model.name}</h4>
                      <span className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                        {model.videoCount != null && model.imageCount != null && (model.videoCount > 0 || model.imageCount > 0)
                          ? t("videosPhotosCount", { videoCount: model.videoCount, imageCount: model.imageCount })
                          : `${model.contentCount} ${t("items")}`}
                      </span>
                    </div>
                  </div>
                </CatalogNavLink>
                </CatalogModelSurfaceTracker>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Bundle Banner */}
      {userAccessModelIds !== "all" && (bundleCost14d > 0 || bundleCost30d > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8 rounded-2xl border border-white/[0.08] bg-card p-5 sm:p-6"
        >
          <div className="flex flex-col lg:flex-row items-center justify-between gap-5">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Crown className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-heading text-lg font-bold tracking-tight">{t("purchaseBundle")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("bundleBannerDesc", { count: totalModelCount })}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3 w-full lg:w-auto">
              {bundleCost14d > 0 && (
                <Button
                  variant="outline"
                  className="bg-white/[0.02] hover:bg-primary/10 border-white/[0.08] hover:border-primary/30 flex min-h-[48px] flex-col items-center justify-center p-5 h-auto rounded-xl touch-manipulation sm:min-h-0"
                  onClick={openBundlePopup}
                >
                  <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-widest">14 {t("days")}</span>
                  <span className="text-base font-bold">{bundleCost14d} {t("credits")}</span>
                </Button>
              )}
              {bundleCost30d > 0 && (
                <Button
                  variant="default"
                  className="flex min-h-[48px] flex-col items-center justify-center p-5 h-auto rounded-xl touch-manipulation sm:min-h-0"
                  onClick={openBundlePopup}
                >
                  <span className="text-[10px] text-primary-foreground/80 mb-1 uppercase tracking-widest">30 {t("days")}</span>
                  <span className="text-base font-bold">{bundleCost30d} {t("credits")}</span>
                  <span className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground/90">{t("best")}</span>
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Search + country on one row (narrower search); filters beside */}
      <div className="catalog-control-shelf sticky top-[4.55rem] z-30 mb-6 flex flex-col gap-3 rounded-xl border border-white/[0.07] px-2.5 py-2.5 slide-up" style={{ animationDelay: "0.15s" }}>
        <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-3">
          <div className="relative min-w-0 flex-1 max-w-full min-[480px]:max-w-xl md:max-w-2xl" data-tour="tour-guest-search">
            <label htmlFor="catalog-search" className="sr-only">
              {t("searchLabel")}
            </label>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" aria-hidden />
            <Input
              id="catalog-search"
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 w-full"
              autoComplete="off"
            />
          </div>
          {(countriesWithModels.length > 0 || isAuthenticated) && (
            <div
              className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-center min-[480px]:gap-2 min-[480px]:shrink-0"
              data-tour="tour-guest-filters"
            >
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPurchasedOnly(!showPurchasedOnly);
                    if (!showPurchasedOnly) setSelectedCountry(null);
                  }}
                  className={cn(
                    "min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer border shrink-0 text-left min-[480px]:min-h-0 min-[480px]:text-center touch-manipulation",
                    showPurchasedOnly
                      ? "bg-success text-white border-success transition-colors duration-200 hover:bg-success/90"
                      : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-muted-foreground transition-colors duration-200"
                  )}
                >
                  {t("purchasedTab")}
                </button>
              )}
              {countriesWithModels.length > 0 && (
                <div className="flex w-full min-w-0 min-[480px]:w-auto min-[480px]:min-w-[200px] min-[480px]:max-w-[min(100%,280px)]">
                  <label htmlFor="catalog-country" className="sr-only">
                    {t("filterByCountry")}
                  </label>
                  <select
                    id="catalog-country"
                    disabled={showPurchasedOnly}
                    value={selectedCountry ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSelectedCountry(v.length > 0 ? v : null);
                      setShowPurchasedOnly(false);
                    }}
                  className={cn(
                    "h-11 w-full min-w-0 rounded-lg border border-white/[0.08] bg-card px-3 text-base text-foreground transition-colors duration-200 md:h-10 md:text-sm",
                    "focus-visible:border-[oklch(0.68_0.11_48_/_0.55)] focus-visible:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.68_0.11_48_/_0.25)] touch-manipulation",
                      showPurchasedOnly && "cursor-not-allowed opacity-50"
                    )}
                  >
                    <option value="">{t("allCountries")}</option>
                    {countriesWithModels.map((country) => (
                      <option key={country.id} value={country.id}>
                        {country.flagEmoji} {country.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="min-h-[44px] rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground min-[480px]:min-h-0 touch-manipulation"
                >
                  {t("resetFilters")}
                </button>
              )}
            </div>
          )}
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-2">
            {search.trim().length > 0 && (
              <span className="rounded-md border border-primary/35 bg-primary/12 px-2 py-1 text-[11px] font-medium text-primary">
                {t("searchLabel")}: {search.trim().slice(0, 24)}
              </span>
            )}
            {activeCountryName && (
              <span className="rounded-md border border-primary/35 bg-primary/12 px-2 py-1 text-[11px] font-medium text-primary">
                {t("filterByCountry")}: {activeCountryName}
              </span>
            )}
            {showPurchasedOnly && (
              <span className="rounded-md border border-success/35 bg-success/12 px-2 py-1 text-[11px] font-medium text-success">
                {t("purchasedTab")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Models Grid */}
      {displayModels.length === 0 && !loading ? (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="mx-auto h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium">{t("noModels")}</p>
        </div>
      ) : displayModels.length === 0 && loading ? (
        /* Skeleton while search/filter loads — avoids blank flash */
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] rounded-lg bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="catalog-sheet-grid grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {displayModels.map((model, index) => {
              const staggerClass =
                index < 12 ? `animate-in fade-in stagger-${Math.min(index + 1, 10)}` : "";
              return (
                <CatalogModelSurfaceTracker
                  key={model.id}
                  modelId={model.id}
                  folderName={model.folderName}
                  surface="grid"
                  gridIndex={index}
                  queryLen={search.trim().length}
                  countryId={selectedCountry}
                  purchasedOnly={showPurchasedOnly}
                  className={cn("grid-item-contain", staggerClass)}
                >
                  <ModelCard
                    model={model}
                    hasAccess={hasAccess}
                    cost7d={cost7d}
                    t={t}
                    onModelClick={(m, e) => handleModelClick(m, e, "grid", index)}
                    imagePriority={index < 6}
                  />
                </CatalogModelSurfaceTracker>
              );
            })}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelCallbackRef} className="flex justify-center py-8">
            {loading && (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
            {!loading && !cursor && displayModels.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {displayModels.length} / {filteredMode || showPurchasedOnly ? displayModels.length : totalModelCount} {t("modelsCount")}
              </p>
            )}
          </div>
        </>
      )}

      <AccessRequiredPopup
        open={popupOpen}
        onOpenChange={setPopupOpen}
        modelId={popupModelId}
        modelName={popupModelName}
        redirectPath={popupModelSlug ? `/models/${popupModelSlug}` : popupIsBundle ? "/" : undefined}
        cost7d={cost7d}
        cost30d={cost30d}
        isBundle={popupIsBundle}
        bundleCost14d={bundleCost14d}
        bundleCost30d={bundleCost30d}
        isAuthenticated={isAuthenticated}
        initialCreditBalance={creditBalance}
      />
    </>
  );
}
