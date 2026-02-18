"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Lock, Unlock, Search, Crown, Sparkles, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessRequiredPopup } from "@/components/access-required-popup";

interface ModelItem {
  id: string;
  name: string;
  folderName: string;
  description: string | null;
  countryId: string | null;
  countryName: string | null;
  countryFlag: string | null;
  contentCount: number;
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
  initialCursor: string | null;
  totalModelCount: number;
  countries: CountryItem[];
  cost7d: number;
  cost30d: number;
  bundleCreditCost: number;
  topModelIds: string[];
  userAccessModelIds: string[] | "all";
  isAuthenticated: boolean;
  creditBalance: number;
}

export function ModelsGrid({
  initialModels,
  initialCursor,
  totalModelCount,
  countries,
  cost7d,
  cost30d,
  bundleCreditCost,
  topModelIds,
  userAccessModelIds,
  isAuthenticated,
  creditBalance,
}: ModelsGridProps) {
  const t = useTranslations("models");
  const router = useRouter();

  const [models, setModels] = useState<ModelItem[]>(initialModels);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupModelId, setPopupModelId] = useState<string | undefined>();
  const [popupModelName, setPopupModelName] = useState<string | undefined>();
  const [bundlePurchasing, setBundlePurchasing] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [initialLoaded, setInitialLoaded] = useState(initialModels.length > 0);

  // For search/filter, we re-fetch from the API
  const [filteredMode, setFilteredMode] = useState(false);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Fetch models from API (used for load more + search/filter)
  const fetchModels = useCallback(
    async (opts: { cursor?: string; search?: string; country?: string; reset?: boolean }) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (opts.cursor) params.set("cursor", opts.cursor);
        params.set("limit", "20");
        if (opts.search) params.set("search", opts.search);
        if (opts.country) params.set("country", opts.country);

        const res = await fetch(`/api/models?${params.toString()}`);
        if (!res.ok) return;

        const data = await res.json();
        if (opts.reset) {
          setModels(data.models);
        } else {
          setModels((prev) => [...prev, ...data.models]);
        }
        setCursor(data.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced search / filter change
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    // If no filters, use initial data when present
    if (!search && !selectedCountry) {
      if (initialModels.length > 0) {
        setFilteredMode(false);
        setModels(initialModels);
        setCursor(initialCursor);
      }
      return;
    }

    setFilteredMode(true);
    searchTimerRef.current = setTimeout(() => {
      fetchModels({ search: search || undefined, country: selectedCountry || undefined, reset: true });
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search, selectedCountry, fetchModels, initialModels, initialCursor]);

  useEffect(() => {
    if (initialLoaded || initialModels.length > 0) return;
    setInitialLoaded(true);
    fetchModels({ reset: true });
  }, [initialLoaded, initialModels.length, fetchModels]);

  // Load more
  const loadMore = useCallback(() => {
    if (loading || !cursor) return;
    fetchModels({
      cursor,
      search: search || undefined,
      country: selectedCountry || undefined,
    });
  }, [loading, cursor, fetchModels, search, selectedCountry]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursor && !loading) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, loading, loadMore]);

  const hasAccess = (modelId: string) => {
    if (userAccessModelIds === "all") return true;
    return userAccessModelIds.includes(modelId);
  };

  const handleModelClick = (model: ModelItem, e: React.MouseEvent) => {
    if (!hasAccess(model.id)) {
      e.preventDefault();
      setPopupModelId(model.id);
      setPopupModelName(model.name);
      setPopupOpen(true);
    }
  };

  // Bundle purchase handler
  const handleBundlePurchase = async () => {
    if (!isAuthenticated) {
      setPopupModelId(undefined);
      setPopupModelName(undefined);
      setPopupOpen(true);
      return;
    }

    // Check balance logic strictly against prop or fetch fresh
    if (creditBalance < bundleCreditCost) {
      // Ideally fetch fresh to be sure, but prop is okay for initial check
      // Let's keep existing logic of fetching fresh balance for safety
    }

    // Existing logic fetched /api/user/balance. That is still valid and good.
    try {
      const balanceRes = await fetch("/api/user/balance");
      if (balanceRes.ok) {
        const balanceData = await balanceRes.json();
        if (balanceData.creditBalance < bundleCreditCost) {
          setBundleError(`Insufficient credits. You have ${balanceData.creditBalance} but need ${bundleCreditCost}.`);
          return;
        }
      }
    } catch {
      // Continue with purchase, server will validate
    }

    setBundlePurchasing(true);
    setBundleError(null);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: null }),
      });
      if (!res.ok) {
        const data = await res.json();
        const errorMessage = data.error?.message || data.error || "Bundle purchase failed";
        setBundleError(errorMessage);
        return;
      }
      router.refresh();
    } catch {
      setBundleError("Purchase failed. Please try again.");
    } finally {
      setBundlePurchasing(false);
    }
  };

  // Get countries that have models (from initial full list)
  const countriesWithModels = countries.filter((c) =>
    initialModels.some((m) => m.countryId === c.id)
  );

  // Top creators from the topModelIds prop, or fallback to first 4
  // Use 'models' state instead of 'initialModels' prop so it populates after client-side fetch if needed
  const topCreators = topModelIds.length > 0
    ? topModelIds.map((id) => models.find((m) => m.id === id)).filter(Boolean) as ModelItem[]
    : models.slice(0, 4);

  return (
    <>
      {/* Page Title */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
      </div>

      {/* Featured & Recommended Section - Only show when not searching/filtering */}
      {!filteredMode && topCreators.length > 0 && (
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-6">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold tracking-wide uppercase text-white/90">Featured & Recommended</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-auto md:h-[450px]">
            {/* Main Hero Card (Takes 2 columns) */}
            <div className="md:col-span-2 relative group overflow-hidden rounded-xl border border-white/5 bg-secondary/20">
              <Link href={`/models/${topCreators[0].folderName}`} onClick={(e) => handleModelClick(topCreators[0], e)}>
                <img
                  src={`/api/models/${topCreators[0].folderName}/thumbnail`} // Use thumbnail or specific cover if available
                  alt={topCreators[0].name}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.style.display = "none";
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#020202] via-black/40 to-transparent opacity-90" />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent opacity-60" />

                <div className="absolute bottom-0 left-0 p-8 w-full max-w-2xl">
                  <div className="mb-2">
                    <Badge variant="default" className="bg-primary/90 hover:bg-primary text-white border-none rounded-md px-3 py-1 uppercase text-xs tracking-wider">
                      Top Creator
                    </Badge>
                  </div>
                  <h3 className="text-5xl font-extrabold text-white mb-2 tracking-tight">
                    {topCreators[0].name}
                  </h3>
                  <p className="text-white/70 line-clamp-2 max-w-lg text-lg mb-6">
                    {topCreators[0].description || `Check out exclusive content from ${topCreators[0].name}. Access full galleries and videos now.`}
                  </p>

                  <div className="flex items-center gap-6 text-sm font-medium text-white/90">
                    <span className="flex items-center gap-2">
                      {topCreators[0].contentCount} Videos
                    </span>
                    <span className="flex items-center gap-2 text-white/50">•</span>
                    <span className="flex items-center gap-2">
                      {topCreators[0].countryName} {topCreators[0].countryFlag}
                    </span>
                  </div>
                </div>
              </Link>
            </div>

            {/* Side List (Takes 1 column) */}
            <div className="flex flex-col gap-3">
              {topCreators.slice(1, 4).map((model) => (
                <Link
                  key={model.id}
                  href={`/models/${model.folderName}`}
                  onClick={(e) => handleModelClick(model, e)}
                  className="flex-1 relative group overflow-hidden rounded-xl border border-white/5 bg-secondary/20 min-h-[100px]"
                >
                  <div className="absolute inset-0 flex">
                    <div className="w-1/3 relative h-full">
                      <img
                        src={`/api/models/${model.folderName}/thumbnail`}
                        alt={model.name}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-black/20 to-[#020202]" />
                    </div>
                    <div className="w-2/3 p-4 flex flex-col justify-center bg-[#0a0a0f]">
                      <h4 className="text-lg font-bold text-white group-hover:text-primary transition-colors">{model.name}</h4>
                      <span className="text-xs text-muted-foreground">{model.contentCount} items</span>
                    </div>
                  </div>

                  {/* Hover styling */}
                  <div className="absolute inset-0 border border-transparent group-hover:border-primary/20 rounded-xl transition-all pointer-events-none" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bundle Banner */}
      {userAccessModelIds !== "all" && bundleCreditCost > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 rounded-xl bg-gradient-to-r from-primary/20 via-purple-500/20 to-primary/20 border border-primary/30 p-6"
        >
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Sparkles className="h-8 w-8 text-primary" />
              <div>
                <h3 className="text-lg font-bold">{t("purchaseBundle")}</h3>
                <p className="text-sm text-muted-foreground">
                  Get lifetime access to all {totalModelCount} creators + future content
                </p>
              </div>
            </div>
            <Button
              size="lg"
              className="whitespace-nowrap"
              onClick={handleBundlePurchase}
              disabled={bundlePurchasing}
            >
              {bundlePurchasing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              {bundleCreditCost} Credits
            </Button>
          </div>
          {bundleError && (
            <p className="text-sm text-destructive mt-3">{bundleError}</p>
          )}
        </motion.div>
      )}

      {/* Search + Country Filters */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("allModels")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCountry(null)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer border ${!selectedCountry
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary hover:bg-secondary/80 border-border"
              }`}
          >
            All
          </button>
          {countriesWithModels.map((country) => (
            <button
              key={country.id}
              onClick={() => setSelectedCountry(country.id)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors cursor-pointer border ${selectedCountry === country.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary hover:bg-secondary/80 border-border"
                }`}
            >
              {country.flagEmoji} {country.name}
            </button>
          ))}
        </div>
      </div>

      {/* Models Grid */}
      {models.length === 0 && !loading ? (
        <div className="text-center py-20 text-muted-foreground">
          <p>{t("noModels")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {models.map((model) => (
              <div key={model.id} className="animate-in fade-in duration-300">
                <Link
                  href={`/models/${model.folderName}`}
                  onClick={(e) => handleModelClick(model, e)}
                  className="group block"
                >
                  <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-[#0a0a0f] border border-white/5 group-hover:border-primary/50 transition-all duration-300">
                    {/* Real R2 thumbnail */}
                    <img
                      src={`/api/models/${model.folderName}/thumbnail`}
                      alt={model.name}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        img.style.display = "none";
                        const fallback = img.nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                    {/* Visible fallback placeholder */}
                    <div
                      className="absolute inset-0 items-center justify-center bg-gradient-to-br from-secondary to-muted"
                      style={{ display: "none" }}
                    >
                      <span className="text-4xl font-bold text-muted-foreground/40">
                        {model.name.charAt(0).toUpperCase()}
                      </span>
                    </div>

                    {/* Gradient Overlay - Deeper Black at bottom */}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#020202] via-transparent to-transparent opacity-80" />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-all duration-300" />

                    {/* Access badge - Simplified */}
                    <div className="absolute top-3 right-3">
                      {hasAccess(model.id) ? (
                        <div className="bg-green-500/20 backdrop-blur-md p-1.5 rounded-md border border-green-500/30 text-green-400">
                          <Unlock className="h-3.5 w-3.5" />
                        </div>
                      ) : (
                        <div className="bg-black/40 backdrop-blur-md p-1.5 rounded-md border border-white/10 text-white/70">
                          <Lock className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>

                    {/* Country flag */}
                    {model.countryFlag && (
                      <div className="absolute top-3 left-3">
                        <span className="text-xl drop-shadow-md">{model.countryFlag}</span>
                      </div>
                    )}

                    {/* Info overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-4 transform translate-y-1 group-hover:translate-y-0 transition-transform duration-300">
                      <h3 className="text-lg font-bold text-white truncate drop-shadow-sm">{model.name}</h3>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-medium text-white/60 bg-white/5 px-2 py-0.5 rounded-sm border border-white/5">
                          {model.contentCount} items
                        </span>
                        {!hasAccess(model.id) && cost7d > 0 && (
                          <span className="text-xs text-primary-foreground bg-primary px-2 py-0.5 rounded-sm font-bold shadow-sm shadow-primary/20">
                            Get Access
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
          <div ref={sentinelRef} className="flex justify-center py-8">
            {loading && (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
            {!loading && !cursor && models.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {models.length} of {filteredMode ? models.length : totalModelCount} models
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
        cost7d={cost7d}
        cost30d={cost30d}
        isAuthenticated={isAuthenticated}
        initialCreditBalance={creditBalance}
      />
    </>
  );
}
