"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import {
  UserPlus,
  Copy,
  Check,
  Coins,
  Users,
  ShoppingBag,
  Gift,
  MousePointerClick,
  Banknote,
  TrendingUp,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCredits } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { trackReferralPanelViewed } from "@/lib/growth-analytics";

type ReferralData = {
  referralCode: string;
  referralLink: string;
  legacyLink?: string;
  stats: {
    totalReferred: number;
    totalPurchased: number;
    totalCreditsEarned: number;
    clicks?: number;
    revenue?: number;
  };
  dailyClicks?: Array<{ date: string; count: number }>;
  recentCredits: Array<{ credits: number; email: string; at: string }>;
  bonuses?: {
    creditsReferrer: number;
    bonusPercentReferee: number;
  };
};

type CopyKind = "main" | "legacy";

function hapticSuccess(): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  navigator.vibrate(14);
}

function formatAwardedAt(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

/** Odporna na brakujące pola / złe typy z API (proxy, cache, starszy backend). */
function normalizeReferralPayload(raw: unknown): ReferralData | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const code = o.referralCode;
  const link = o.referralLink;
  if (typeof code !== "string" || typeof link !== "string" || !code.trim() || !link.trim()) {
    return null;
  }

  const statsRaw = o.stats && typeof o.stats === "object" ? (o.stats as Record<string, unknown>) : {};
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  let dailyClicks: ReferralData["dailyClicks"];
  if (Array.isArray(o.dailyClicks)) {
    dailyClicks = o.dailyClicks
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const date = typeof r.date === "string" ? r.date : "";
        const count = typeof r.count === "number" && !Number.isNaN(r.count) ? r.count : Number(r.count);
        if (!date || Number.isNaN(count)) return null;
        return { date, count };
      })
      .filter((x): x is { date: string; count: number } => x !== null);
  }

  let recentCredits: ReferralData["recentCredits"] = [];
  if (Array.isArray(o.recentCredits)) {
    recentCredits = o.recentCredits
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const credits = typeof r.credits === "number" ? r.credits : Number(r.credits);
        const email = typeof r.email === "string" ? r.email : "";
        const at = typeof r.at === "string" ? r.at : "";
        if (Number.isNaN(credits)) return null;
        return { credits, email, at };
      })
      .filter((x): x is { credits: number; email: string; at: string } => x !== null);
  }

  let bonuses: ReferralData["bonuses"];
  if (o.bonuses && typeof o.bonuses === "object") {
    const b = o.bonuses as Record<string, unknown>;
    const cr = b.creditsReferrer;
    const br = b.bonusPercentReferee;
    bonuses = {
      creditsReferrer: typeof cr === "number" && !Number.isNaN(cr) ? cr : Number(cr) || 0,
      bonusPercentReferee: typeof br === "number" && !Number.isNaN(br) ? br : Number(br) || 0,
    };
  }

  return {
    referralCode: code.trim(),
    referralLink: link.trim(),
    legacyLink: typeof o.legacyLink === "string" && o.legacyLink.trim() ? o.legacyLink.trim() : undefined,
    stats: {
      totalReferred: Math.max(0, Math.floor(num(statsRaw.totalReferred))),
      totalPurchased: Math.max(0, Math.floor(num(statsRaw.totalPurchased))),
      totalCreditsEarned: Math.max(0, Math.floor(num(statsRaw.totalCreditsEarned))),
      clicks: Math.max(0, Math.floor(num(statsRaw.clicks))),
      revenue: Math.max(0, num(statsRaw.revenue)),
    },
    dailyClicks: dailyClicks && dailyClicks.length > 0 ? dailyClicks : undefined,
    recentCredits,
    bonuses,
  };
}

function ReferralPanelSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-9 w-56 animate-pulse rounded-md bg-white/[0.08]" />
        <div className="h-4 max-w-md animate-pulse rounded-md bg-white/[0.05]" />
        <div className="h-4 w-2/3 max-w-sm animate-pulse rounded-md bg-white/[0.04]" />
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-white/[0.08] bg-card/50 p-6 shadow-lg shadow-black/10"
        >
          <div className="mb-4 h-5 w-40 animate-pulse rounded bg-white/[0.08]" />
          <div className="h-11 w-full animate-pulse rounded-md bg-white/[0.06]" />
          <div className="mt-4 h-3 w-3/4 animate-pulse rounded bg-white/[0.05]" />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, j) => (
          <div
            key={j}
            className="h-24 animate-pulse rounded-lg border border-white/[0.06] bg-white/[0.04]"
          />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function ReferralPanel() {
  const t = useTranslations("referral");
  const tc = useTranslations("common");
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelViewTracked = useRef(false);

  const fetchReferral = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/referral/me", { credentials: "include" });
      if (!res.ok) {
        setData(null);
        return;
      }
      let raw: unknown;
      try {
        raw = await res.json();
      } catch {
        setData(null);
        return;
      }
      const normalized = normalizeReferralPayload(raw);
      setData(normalized);
      if (!normalized) {
        logger.error("Referral API returned unexpected shape");
      }
    } catch (err) {
      logger.error("Failed to fetch referral data", err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReferral();
  }, [fetchReferral]);

  useEffect(() => {
    if (!data || panelViewTracked.current) return;
    panelViewTracked.current = true;
    trackReferralPanelViewed();
  }, [data]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const copyToClipboard = async (text: string, which: CopyKind) => {
    if (!text) return;
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    try {
      await navigator.clipboard.writeText(text);
      hapticSuccess();
      setCopied(which);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(null);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      logger.error("Copy failed", err);
    }
  };

  if (loading && !data) {
    return (
      <div className="relative space-y-6">
        <ReferralPanelSkeleton />
        <span className="sr-only">{tc("loading")}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="relative space-y-4 rounded-xl border border-white/[0.08] bg-card/80 p-8 text-center shadow-lg shadow-black/20">
        <p className="text-muted-foreground">{t("loadError")}</p>
        <Button type="button" variant="outline" onClick={() => void fetchReferral()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t("retry")}
        </Button>
      </div>
    );
  }

  const statTileClass =
    "rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 transition-[transform,box-shadow] duration-200 hover:border-white/[0.12] hover:shadow-md hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 motion-reduce:transition-none";

  return (
    <motion.div
      className="relative space-y-6"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={reduceMotion ? false : { opacity: 1, y: 0 }}
      transition={
        reduceMotion ? undefined : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
      }
    >
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <UserPlus className="h-7 w-7 shrink-0 text-primary" aria-hidden />
          {t("title")}
        </h1>
        <p className="mt-2 text-muted-foreground">{t("description")}</p>
      </div>

      <Card className="border-white/[0.08] bg-card shadow-lg shadow-black/20">
        <CardHeader>
          <CardTitle className="text-lg">{t("yourLink")}</CardTitle>
          <CardDescription>{t("shareLink")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={data.referralLink}
              className="bg-secondary font-mono text-sm border-white/[0.08]"
              aria-label={t("yourLink")}
            />
            <Button
              type="button"
              onClick={() => copyToClipboard(data.referralLink, "main")}
              className="h-11 min-h-[44px] shrink-0 min-w-[44px] sm:w-auto"
              variant="outline"
              aria-label={t("modalCopyLink")}
            >
              {copied === "main" ? (
                <Check className="h-4 w-4 text-green-500" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("codeLabel")}: <code className="rounded bg-secondary px-1.5 py-0.5">{data.referralCode}</code>
            {data.referralLink?.includes("/r/") && (
              <span className="ml-2 text-primary/80">· {t("trackableLink")}</span>
            )}
          </p>

          {data.legacyLink && data.legacyLink !== data.referralLink && (
            <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-sm font-medium">{t("legacyLinkTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("legacyLinkDesc")}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  readOnly
                  value={data.legacyLink}
                  className="bg-secondary font-mono text-xs border-white/[0.08]"
                  aria-label={t("legacyLinkTitle")}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 shrink-0 gap-2"
                  onClick={() => copyToClipboard(data.legacyLink!, "legacy")}
                >
                  {copied === "legacy" ? (
                    <Check className="h-4 w-4 shrink-0 text-green-500" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="text-sm">{t("copyLegacy")}</span>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/[0.08] bg-card shadow-lg shadow-black/20">
        <CardHeader>
          <CardTitle className="text-lg">{t("stats")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <div className={statTileClass}>
              <MousePointerClick className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-xl font-semibold tabular-nums">{data.stats.clicks ?? 0}</p>
              <p className="text-xs text-muted-foreground">{t("clicks")}</p>
            </div>
            <div className={statTileClass}>
              <Users className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-xl font-semibold tabular-nums">{data.stats.totalReferred}</p>
              <p className="text-xs text-muted-foreground">{t("totalReferred")}</p>
            </div>
            <div className={statTileClass}>
              <ShoppingBag className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-xl font-semibold tabular-nums">{data.stats.totalPurchased}</p>
              <p className="text-xs text-muted-foreground">{t("totalPurchased")}</p>
            </div>
            <div className={statTileClass}>
              <Coins className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-xl font-semibold tabular-nums">{formatCredits(data.stats.totalCreditsEarned)}</p>
              <p className="text-xs text-muted-foreground">{t("totalCreditsEarned")}</p>
            </div>
            <div className={`${statTileClass} col-span-2 sm:col-span-1`}>
              <Banknote className="mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
              <p className="text-xl font-semibold tabular-nums">
                {Number.isFinite(data.stats.revenue) ? (data.stats.revenue ?? 0).toFixed(2) : "0.00"}
              </p>
              <p className="text-xs text-muted-foreground">{t("revenue")} PLN</p>
            </div>
          </div>

          {data.dailyClicks && data.dailyClicks.length > 0 && (
            <div className="mt-6 border-t border-white/[0.06] pt-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <TrendingUp className="h-3.5 w-3 shrink-0" aria-hidden />
                {t("clicksLast7Days")}
              </p>
              <div
                className="flex h-24 w-full items-end gap-1"
                role="img"
                aria-label={t("clicksLast7Days")}
              >
                {data.dailyClicks.map((d, i) => {
                  const maxCount = Math.max(...data.dailyClicks!.map((x) => x.count), 1);
                  const heightPct = Math.max((d.count / maxCount) * 100, 4);
                  return (
                    <div
                      key={`${d.date}-${i}`}
                      className="group flex flex-1 flex-col items-center justify-end"
                      title={`${d.date}: ${d.count} ${t("clicks")}`}
                    >
                      <div
                        className="w-full rounded-t bg-primary/30 transition-colors hover:bg-primary/50 motion-reduce:transition-none"
                        style={{ height: `${heightPct}%`, minHeight: "4px" }}
                      />
                      <span className="mt-1 w-full truncate text-center text-[10px] text-muted-foreground">
                        {d.date.length >= 5 ? d.date.slice(5) : d.date}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {data.recentCredits.length > 0 && (
        <Card className="border-white/[0.08] bg-card shadow-lg shadow-black/20">
          <CardHeader>
            <CardTitle className="text-lg">{t("recentCredits")}</CardTitle>
            <CardDescription>{t("recentCreditsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-80 divide-y divide-white/[0.06] overflow-y-auto rounded-md border border-white/[0.06]">
              {data.recentCredits.map((rc, i) => {
                const when = formatAwardedAt(rc.at, locale);
                return (
                  <li
                    key={`${rc.at}-${rc.email}-${i}`}
                    className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{rc.email || t("unknown")}</span>
                      {when ? (
                        <span className="text-[11px] text-muted-foreground">{when}</span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-sm font-medium text-primary tabular-nums">
                      +{formatCredits(rc.credits)} {t("credits")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <Gift className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-medium">{t("howItWorks")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.bonuses ? (
                  t("howItWorksDescWithBonuses", {
                    creditsReferrer: data.bonuses.creditsReferrer,
                    bonusPercentReferee: data.bonuses.bonusPercentReferee,
                  })
                ) : (
                  t("howItWorksDesc")
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
