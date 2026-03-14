"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Unlock, Search, Crown, Sparkles, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessRequiredPopup } from "@/components/access-required-popup";
import { cn } from "@/lib/utils";
import { RetryImage } from "@/components/ui/retry-image";

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
  const router = useRouter();

  const [models, setModels] = useState<ModelItem[]>(() => {
    if (typeof window === "undefined") return initialModels;
    if (sessionStorage.getItem("models_search") || sessionStorage.getItem("models_country")) {
      return [];
    }
    return initialModels;
  });
  const [cursor, setCursor] = useState<string | null>(() => {
    if (typeof window === "undefined") return initialCursor;
    if (sessionStorage.getItem("models_search") || sessionStorage.getItem("models_country")) {
      return null;
    }
    return initialCursor;
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(() => {
    if (typeof window === "undefined") return "";
    const v = sessionStorage.getItem("models_search");
    return v != null ? String(v).slice(0, 500) : "";
  });
  const [selectedCountry, setSelectedCountry] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const v = sessionStorage.getItem("models_country");
    return v && v.length <= 64 ? v : null;
  });
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupModelId, setPopupModelId] = useState<string | undefined>();
  const [popupModelName, setPopupModelName] = useState<string | undefined>();
  const [popupModelSlug, setPopupModelSlug] = useState<string | undefined>();
  const [popupIsBundle, setPopupIsBundle] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(initialModels.length > 0);

  const [activeIndex, setActiveIndex] = useState(0);

  const [filteredMode, setFilteredMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!(sessionStorage.getItem("models_search") || sessionStorage.getItem("models_country"));
  });
  const [showPurchasedOnly, setShowPurchasedOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("models_purchased_only") === "1";
  });

  // Persist folder search state (same logic as filter/sort in model folders)
  useEffect(() => {
    if (typeof window !== "undefined") sessionStorage.setItem("models_search", search.slice(0, 500));
  }, [search]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (selectedCountry) sessionStorage.setItem("models_country", selectedCountry);
      else sessionStorage.removeItem("models_country");
    }
  }, [selectedCountry]);
  useEffect(() => {
    if (typeof window !== "undefined") sessionStorage.setItem("models_purchased_only", showPurchasedOnly ? "1" : "0");
  }, [showPurchasedOnly]);

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

        const res = await fetch(`/api/models?${params.toString()}`, { signal: opts.signal });
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
    searchTimerRef.current = setTimeout(doFetch, isInitialWithFilters ? 0 : 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      controller.abort();
      abortControllerRef.current = null;
    };
  }, [search, selectedCountry, fetchModels, initialModels, initialCursor]);

  useEffect(() => {
    if (initialLoaded || initialModels.length > 0) return;
    if (search || selectedCountry) return;
    setInitialLoaded(true);
    fetchModels({ reset: true });
  }, [initialLoaded, initialModels.length, fetchModels, search, selectedCountry]);

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

  const hasAccess = (modelId: string) => {
    if (userAccessModelIds === "all") return true;
    return userAccessModelIds.includes(modelId);
  };

  const handleModelClick = (model: ModelItem, e: React.MouseEvent) => {
    if (!hasAccess(model.id)) {
      e.preventDefault();
      setPopupIsBundle(false);
      setPopupModelId(model.id);
      setPopupModelName(model.name);
      setPopupModelSlug(model.folderName);
      setPopupOpen(true);
    } else {
      // Save scroll position so we can restore it when user returns
      sessionStorage.setItem("models_scroll_y", String(window.scrollY));
    }
  };

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

  return (
    <>
      {/* Page Title */}
      <div className="mb-8 slide-up">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{t("title")}</h1>
      </div>

      {/* Featured Section */}
      {!filteredMode && heroModel && (
        <div className="mb-12 slide-up" style={{ animationDelay: "0.1s" }}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold tracking-widest uppercase text-muted-foreground">Featured</h2>
            </div>
            {displayFeatured.length > 1 && (
              <div className="flex items-center gap-1.5">
                <button onClick={goPrev} className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] transition-colors cursor-pointer">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={goNext} className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] transition-colors cursor-pointer">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[420px]">
            {/* Main Hero Card */}
            <div className="lg:col-span-2 relative group overflow-hidden rounded-2xl border border-white/[0.06] bg-card min-h-[280px] sm:min-h-[340px]">
              <Link href={`/models/${heroModel.folderName}`} onClick={(e) => handleModelClick(heroModel, e)}>
                <AnimatePresence mode="wait">
                  <motion.img
                    key={heroModel.id}
                    src={`/api/models/${heroModel.folderName}/header`}
                    alt={heroModel.name}
                    initial={{ opacity: 0, scale: 1.05 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6 }}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      img.style.display = "none";
                    }}
                  />
                </AnimatePresence>
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />

                <div className="absolute bottom-0 left-0 p-6 sm:p-8 w-full">
                  <div className="mb-3">
                    <Badge className="bg-primary/80 backdrop-blur-sm text-white border-none rounded-lg px-2.5 py-1 text-[10px] tracking-widest uppercase font-semibold">
                      {t("featured")}
                    </Badge>
                  </div>
                  <h3 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-2 tracking-tight leading-tight">
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
                  <div className="absolute bottom-6 right-6 sm:bottom-8 sm:right-8 flex items-center gap-1.5">
                    {displayFeatured.map((_, i) => (
                      <button
                        key={i}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveIndex(i); }}
                        className={cn(
                          "rounded-full transition-all duration-300 cursor-pointer",
                          i === activeIndex ? "w-6 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/30 hover:bg-white/50"
                        )}
                      />
                    ))}
                  </div>
                )}
              </Link>
            </div>

            {/* Side List */}
            <div className="flex flex-row lg:flex-col gap-3 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 -mx-4 px-4 lg:mx-0 lg:px-0">
              {sideModels.map((model) => (
                <Link
                  key={model.id}
                  href={`/models/${model.folderName}`}
                  onClick={(e) => handleModelClick(model, e)}
                  className="flex-shrink-0 w-[260px] lg:w-auto flex-1 relative group overflow-hidden rounded-xl border border-white/[0.06] bg-card transition-all duration-300 hover:border-primary/20"
                >
                  <div className="flex h-full min-h-[100px]">
                    <div className="w-24 lg:w-1/3 relative shrink-0">
                      <RetryImage
                        src={`/api/models/${model.folderName}/thumbnail`}
                        alt={model.name}
                        className="absolute inset-0 w-full h-full object-cover"
                        fallback={
                          <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground/50 text-2xl font-bold">
                            {model.name.charAt(0).toUpperCase()}
                          </div>
                        }
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-card" />
                    </div>
                    <div className="flex-1 p-4 flex flex-col justify-center">
                      <h4 className="text-sm lg:text-base font-bold text-white group-hover:text-primary transition-colors truncate">{model.name}</h4>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        <span className="hidden sm:inline">
                          {model.videoCount != null && model.imageCount != null && (model.videoCount > 0 || model.imageCount > 0)
                            ? t("videosPhotosCount", { videoCount: model.videoCount, imageCount: model.imageCount })
                            : `${model.contentCount} ${t("items")}`}
                        </span>
                        <span className="sm:hidden">{model.contentCount} {t("items")}</span>
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bundle Banner */}
      {userAccessModelIds !== "all" && (bundleCost14d > 0 || bundleCost30d > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8 rounded-2xl bg-gradient-to-r from-primary/10 via-purple-500/10 to-primary/10 border border-primary/20 p-5 sm:p-6"
        >
          <div className="flex flex-col lg:flex-row items-center justify-between gap-5">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                <Crown className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-bold">{t("purchaseBundle")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("bundleBannerDesc", { count: totalModelCount })}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 w-full lg:w-auto">
              {bundleCost14d > 0 && (
                <Button
                  variant="outline"
                  className="bg-white/[0.02] hover:bg-primary/10 border-white/[0.08] hover:border-primary/30 flex flex-col items-center justify-center p-5 h-auto rounded-xl"
                  onClick={openBundlePopup}
                >
                  <span className="text-[10px] text-muted-foreground mb-1 uppercase tracking-widest">14 {t("days")}</span>
                  <span className="text-base font-bold">{bundleCost14d} {t("credits")}</span>
                </Button>
              )}
              {bundleCost30d > 0 && (
                <Button
                  variant="default"
                  className="flex flex-col items-center justify-center p-5 h-auto relative overflow-hidden group rounded-xl"
                  onClick={openBundlePopup}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-purple-600 group-hover:opacity-90 transition-opacity" />
                  <span className="relative text-[10px] text-white/70 mb-1 uppercase tracking-widest">30 {t("days")}</span>
                  <span className="relative text-base font-bold">{bundleCost30d} {t("credits")}</span>
                  <div className="absolute -right-1 -top-1 bg-yellow-400 text-black text-[9px] font-black px-2 py-0.5 rotate-12 rounded-sm">{t("best")}</div>
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Search + Country Filters */}
      <div className="flex flex-col gap-3 mb-6 slide-up" style={{ animationDelay: "0.15s" }}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <Input
            placeholder={t("allModels")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-11"
          />
        </div>
        {countriesWithModels.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { setSelectedCountry(null); setShowPurchasedOnly(false); }}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border",
                !selectedCountry && !showPurchasedOnly
                  ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                  : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-muted-foreground"
              )}
            >
              {t("all")}
            </button>
            {isAuthenticated && (
              <button
                onClick={() => {
                  setShowPurchasedOnly(!showPurchasedOnly);
                  if (!showPurchasedOnly) setSelectedCountry(null);
                }}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border",
                  showPurchasedOnly
                    ? "bg-green-500 text-white border-green-500 shadow-sm shadow-green-500/20"
                    : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-muted-foreground"
                )}
              >
                {t("purchasedTab")}
              </button>
            )}
            {countriesWithModels.map((country) => (
              <button
                key={country.id}
                onClick={() => { setSelectedCountry(country.id); setShowPurchasedOnly(false); }}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer border",
                  selectedCountry === country.id && !showPurchasedOnly
                    ? "bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20"
                    : "bg-white/[0.03] hover:bg-white/[0.06] border-white/[0.08] text-muted-foreground"
                )}
              >
                {country.flagEmoji} {country.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Models Grid */}
      {displayModels.length === 0 && !loading ? (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="mx-auto h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium">{t("noModels")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {displayModels.map((model, index) => (
              <div
                key={model.id}
                className={cn("animate-in fade-in", `stagger-${Math.min(index % 10 + 1, 10)}`)}
              >
                <Link
                  href={`/models/${model.folderName}`}
                  onClick={(e) => handleModelClick(model, e)}
                  className="group block"
                >
                  <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-card border border-white/[0.06] card-hover group-hover:border-primary/30 transition-all duration-300">
                    <RetryImage
                      src={`/api/models/${model.folderName}/thumbnail`}
                      alt={model.name}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
                      loading="lazy"
                      fallback={
                        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-secondary to-muted">
                          <span className="text-4xl font-bold text-muted-foreground/30">
                            {model.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      }
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-80" />
                    <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-all duration-500" />

                    {/* Access badge */}
                    <div className="absolute top-2.5 right-2.5">
                      {hasAccess(model.id) ? (
                        <div className="bg-green-500/20 backdrop-blur-md p-1.5 rounded-lg border border-green-500/20 text-green-400">
                          <Unlock className="h-3 w-3" />
                        </div>
                      ) : (
                        <div className="bg-black/30 backdrop-blur-md p-1.5 rounded-lg border border-white/[0.08] text-white/50">
                          <Lock className="h-3 w-3" />
                        </div>
                      )}
                    </div>

                    {/* Country flag */}
                    {model.countryFlag && (
                      <div className="absolute top-2.5 left-2.5">
                        <span className="text-lg drop-shadow-md">{model.countryFlag}</span>
                      </div>
                    )}

                    {/* Model avatar */}
                    <div className="absolute bottom-12 sm:bottom-14 right-2.5">
                      <RetryImage
                        src={`/api/models/${model.folderName}/avatar`}
                        alt=""
                        className="h-8 w-8 sm:h-9 sm:w-9 rounded-full object-cover border-2 border-white/20 shadow-lg bg-card"
                        loading="lazy"
                      />
                    </div>

                    {/* Info overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 transform translate-y-0.5 group-hover:translate-y-0 transition-transform duration-300">
                      <h3 className="text-sm sm:text-base font-bold text-white truncate">{model.name}</h3>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] sm:text-xs font-medium text-white/50">
                          <span className="hidden sm:inline">
                            {model.videoCount != null && model.imageCount != null && (model.videoCount > 0 || model.imageCount > 0)
                              ? t("videosPhotosCount", { videoCount: model.videoCount, imageCount: model.imageCount })
                              : `${model.contentCount} ${t("items")}`}
                          </span>
                          <span className="sm:hidden">{model.contentCount} {t("items")}</span>
                        </span>
                        {!hasAccess(model.id) && cost7d > 0 && (
                          <span className="text-[10px] sm:text-xs text-primary-foreground bg-primary/90 px-2 py-0.5 rounded-md font-semibold">
                            {t("getAccess")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            ))}
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
