"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, Loader2, RefreshCw } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

export type CatalogPerfRow = {
  modelId: string;
  folderName: string;
  modelName: string;
  impressions: number;
  clicksOpen: number;
  clicksLoginWall: number;
  engagedImpressions: number;
  profileSessions: number;
  avgTimeOnProfileSec: number;
  deepProfileSessions: number;
  ctr: number;
  ctrEngaged: number;
};

/** GET /api/admin/catalog-model-performance `sort` whitelist */
type ApiSortKey =
  | "combined"
  | "ctr"
  | "ctr_engaged"
  | "impressions"
  | "engaged_impressions"
  | "clicks_open"
  | "clicks_wall"
  | "avg_time_profile"
  | "profile_sessions"
  | "deep_profile_sessions"
  | "model";

type SortDir = "asc" | "desc";

function defaultDirForColumn(key: ApiSortKey): SortDir {
  if (key === "model") return "asc";
  return "desc";
}

function pctCtr(ctr: number): string {
  if (!Number.isFinite(ctr) || ctr < 0) return "—";
  return `${(ctr * 100).toFixed(2)}%`;
}

function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "—";
  return `${s.toFixed(1)}s`;
}

export function CatalogEngagementPanel() {
  const t = useTranslations("admin");
  const reduceMotion = useReducedMotion();
  const [days, setDays] = useState(30);
  const [surface, setSurface] = useState<"" | "grid" | "featured_hero" | "featured_side">("");
  const [sortKey, setSortKey] = useState<ApiSortKey>("combined");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [items, setItems] = useState<CatalogPerfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      try {
        const params = new URLSearchParams({
          days: String(days),
          limit: "100",
          sort: sortKey,
          order: sortDir,
        });
        if (surface) params.set("surface", surface);
        const res = await fetch(`/api/admin/catalog-model-performance?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const raw = data.items ?? [];
        setItems(
          raw.map((r: Record<string, unknown>) => ({
            modelId: String(r.modelId ?? ""),
            folderName: String(r.folderName ?? ""),
            modelName: String(r.modelName ?? ""),
            impressions: Number(r.impressions ?? 0),
            clicksOpen: Number(r.clicksOpen ?? 0),
            clicksLoginWall: Number(r.clicksLoginWall ?? 0),
            engagedImpressions: Number(r.engagedImpressions ?? 0),
            profileSessions: Number(r.profileSessions ?? 0),
            avgTimeOnProfileSec: Number(r.avgTimeOnProfileSec ?? 0),
            deepProfileSessions: Number(r.deepProfileSessions ?? 0),
            ctr: Number(r.ctr ?? 0),
            ctrEngaged: Number(r.ctrEngaged ?? 0),
          })),
        );
      } catch (e) {
        logger.error("catalog-model-performance", e);
        setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [days, surface, sortKey, sortDir],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  function handleSortColumn(key: ApiSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(defaultDirForColumn(key));
  }

  function renderSortIcon(column: ApiSortKey) {
    const active = sortKey === column;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-[opacity,transform] duration-200",
          active
            ? "text-emerald-400 opacity-100"
            : "text-muted-foreground/45 opacity-80 group-hover:text-muted-foreground group-hover:opacity-100",
        )}
        aria-hidden
      />
    );
  }

  function sortAriaSort(column: ApiSortKey): "ascending" | "descending" | "none" {
    if (sortKey !== column) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-emerald-400" />
            {t("catalogInsightsTitle")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{t("catalogInsightsDesc")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={refreshing || loading}
          onClick={() => load(true)}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          {t("catalogInsightsRefresh")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground flex items-center gap-2">
          {t("catalogInsightsPeriod")}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className={cn(
              "h-9 rounded-md border border-border bg-background px-2 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-ring/40",
            )}
          >
            <option value={7}>7 {t("catalogInsightsDays")}</option>
            <option value={30}>30 {t("catalogInsightsDays")}</option>
            <option value={90}>90 {t("catalogInsightsDays")}</option>
          </select>
        </label>
        <label className="text-sm text-muted-foreground flex items-center gap-2">
          {t("catalogInsightsSurface")}
          <select
            value={surface}
            onChange={(e) =>
              setSurface(e.target.value as "" | "grid" | "featured_hero" | "featured_side")
            }
            className={cn(
              "h-9 rounded-md border border-border bg-background px-2 text-sm max-w-[220px]",
              "focus:outline-none focus:ring-2 focus:ring-ring/40",
            )}
          >
            <option value="">{t("catalogInsightsSurfaceAll")}</option>
            <option value="grid">{t("catalogInsightsSurfaceGrid")}</option>
            <option value="featured_hero">{t("catalogInsightsSurfaceFeaturedHero")}</option>
            <option value="featured_side">{t("catalogInsightsSurfaceFeaturedSide")}</option>
          </select>
        </label>
        {sortKey !== "combined" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-dashed border-emerald-500/35 text-emerald-200/90 hover:bg-emerald-500/10 hover:text-emerald-100"
            onClick={() => {
              setSortKey("combined");
              setSortDir("desc");
            }}
          >
            <LayoutGrid className="h-3.5 w-3.5 opacity-80" />
            {t("catalogInsightsSortCombinedReset")}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground/90 max-w-3xl leading-relaxed">{t("catalogInsightsSortHint")}</p>

      <div
        className={cn(
          "rounded-2xl border border-white/[0.08] bg-gradient-to-b from-card to-card/80 overflow-hidden",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-8 text-sm text-muted-foreground text-center">{t("catalogInsightsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left py-3 px-3 font-medium" aria-sort={sortAriaSort("model")}>
                    <button
                      type="button"
                      onClick={() => handleSortColumn("model")}
                      className="group inline-flex w-full min-w-0 items-center justify-start gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "model" && "text-foreground")}>{t("catalogInsightsColModel")}</span>
                      {renderSortIcon("model")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("impressions")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("impressions")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "impressions" && "text-foreground")}>
                        {t("catalogInsightsColImpressions")}
                      </span>
                      {renderSortIcon("impressions")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("engaged_impressions")}
                    title={t("catalogInsightsColEngagedHint")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("engaged_impressions")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "engaged_impressions" && "text-foreground")}>
                        {t("catalogInsightsColEngaged")}
                      </span>
                      {renderSortIcon("engaged_impressions")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("clicks_open")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("clicks_open")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "clicks_open" && "text-foreground")}>
                        {t("catalogInsightsColClicksOpen")}
                      </span>
                      {renderSortIcon("clicks_open")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("clicks_wall")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("clicks_wall")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "clicks_wall" && "text-foreground")}>
                        {t("catalogInsightsColClicksWall")}
                      </span>
                      {renderSortIcon("clicks_wall")}
                    </button>
                  </th>
                  <th className="text-right py-3 px-3 font-medium tabular-nums" aria-sort={sortAriaSort("ctr")}>
                    <button
                      type="button"
                      onClick={() => handleSortColumn("ctr")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "ctr" && "text-foreground")}>{t("catalogInsightsColCtr")}</span>
                      {renderSortIcon("ctr")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("ctr_engaged")}
                    title={t("catalogInsightsColCtrEngagedHint")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("ctr_engaged")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "ctr_engaged" && "text-foreground")}>
                        {t("catalogInsightsColCtrEngaged")}
                      </span>
                      {renderSortIcon("ctr_engaged")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("avg_time_profile")}
                    title={t("catalogInsightsColAvgTimeHint")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("avg_time_profile")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "avg_time_profile" && "text-foreground")}>
                        {t("catalogInsightsColAvgTime")}
                      </span>
                      {renderSortIcon("avg_time_profile")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("profile_sessions")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("profile_sessions")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "profile_sessions" && "text-foreground")}>
                        {t("catalogInsightsColProfileSessions")}
                      </span>
                      {renderSortIcon("profile_sessions")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("deep_profile_sessions")}
                    title={t("catalogInsightsColDeepHint")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("deep_profile_sessions")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    >
                      <span className={cn(sortKey === "deep_profile_sessions" && "text-foreground")}>
                        {t("catalogInsightsColDeep")}
                      </span>
                      {renderSortIcon("deep_profile_sessions")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <motion.tr
                    key={row.modelId}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.18,
                      delay: reduceMotion ? 0 : Math.min(i * 0.025, 0.45),
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="border-b border-border/40 hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-medium">{row.folderName}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[240px]">{row.modelName}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{row.impressions}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-sky-200/85">{row.engagedImpressions}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-emerald-200/90">{row.clicksOpen}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-amber-200/80">{row.clicksLoginWall}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">{pctCtr(row.ctr)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium text-cyan-200/85">
                      {pctCtr(row.ctrEngaged)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtSec(row.avgTimeOnProfileSec)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{row.profileSessions}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-violet-200/85">
                      {row.deepProfileSessions}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{t("catalogInsightsFootnote")}</p>
    </div>
  );
}
