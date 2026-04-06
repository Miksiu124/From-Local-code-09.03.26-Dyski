"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Loader2,
  Package,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

export type PerfRow = {
  contentItemId: string;
  contentType: string;
  modelFolderName: string;
  modelName: string;
  thumbOpens: number;
  detailViews: number;
  firstPlays: number;
  photoFirstViews: number;
  totalWatchSeconds: number;
  engagementSessions: number;
  avgWatchSeconds: number;
  hasSourceFile: boolean;
  canExportZip: boolean;
};

/** Must match GET /api/admin/content-performance `sort` whitelist */
type ApiSortKey =
  | "combined"
  | "model"
  | "type"
  | "thumb_opens"
  | "detail_views"
  | "first"
  | "watch"
  | "avg"
  | "source";

type SortDir = "asc" | "desc";

function defaultDirForColumn(key: ApiSortKey): SortDir {
  if (key === "model" || key === "type") return "asc";
  return "desc";
}

export function ContentEngagementPanel() {
  const t = useTranslations("admin");
  const [days, setDays] = useState(30);
  const [sortKey, setSortKey] = useState<ApiSortKey>("combined");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [items, setItems] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);

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
        const res = await fetch(`/api/admin/content-performance?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setItems(data.items ?? []);
        setSelected(new Set());
      } catch (e) {
        logger.error("content-performance", e);
        setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [days, sortKey, sortDir],
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const exportableIds = useMemo(
    () => items.filter((r) => r.canExportZip === true).map((r) => r.contentItemId),
    [items],
  );

  const allExportableSelected =
    exportableIds.length > 0 && exportableIds.every((id) => selected.has(id));

  function toggleSelect(id: string, can: boolean) {
    if (!can) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allExportableSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(exportableIds));
  }

  async function downloadZip() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setZipping(true);
    try {
      const res = await fetch("/api/admin/content/bulk-zip", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentItemIds: ids }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `content-export-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      logger.error("bulk-zip", e);
      alert(e instanceof Error ? e.message : "ZIP failed");
    } finally {
      setZipping(false);
    }
  }

  function fmtSec(s: number) {
    if (!Number.isFinite(s) || s < 0) return "0s";
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return `${h}h ${mm}m`;
    }
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

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
          active ? "text-violet-400 opacity-100" : "text-muted-foreground/45 opacity-80 group-hover:text-muted-foreground group-hover:opacity-100",
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
            <Sparkles className="h-6 w-6 text-violet-400" />
            {t("contentInsightsTitle")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{t("contentInsightsDesc")}</p>
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
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-muted-foreground flex items-center gap-2">
            {t("contentInsightsPeriod")}
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className={cn(
                "h-9 rounded-md border border-border bg-background px-2 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-ring/40",
              )}
            >
              <option value={7}>7 {t("contentInsightsDays")}</option>
              <option value={30}>30 {t("contentInsightsDays")}</option>
              <option value={90}>90 {t("contentInsightsDays")}</option>
            </select>
          </label>

          {sortKey !== "combined" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 border-dashed border-violet-500/35 text-violet-200/90 hover:bg-violet-500/10 hover:text-violet-100"
              onClick={() => {
                setSortKey("combined");
                setSortDir("desc");
              }}
            >
              <Sparkles className="h-3.5 w-3.5 opacity-80" />
              {t("contentInsightsSortCombinedReset")}
            </Button>
          ) : null}

          <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={exportableIds.length === 0 || loading}
              onClick={toggleSelectAll}
              className="text-xs"
            >
              {allExportableSelected ? t("dashboardDeselectAll") : t("dashboardSelectExportable")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={selected.size === 0 || zipping}
              onClick={() => void downloadZip()}
              className="gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white border-0 shadow-lg shadow-violet-500/20"
            >
              {zipping ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Package className="h-4 w-4" />
              )}
              {t("dashboardZipSelected", { count: selected.size })}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/90 max-w-3xl leading-relaxed">{t("contentInsightsSortHintBar")}</p>
      </div>

      {!loading && items.length > 0 && exportableIds.length === 0 ? (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90"
        >
          {t("dashboardNoExportable")}
        </div>
      ) : null}

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
          <p className="p-8 text-sm text-muted-foreground text-center">{t("contentInsightsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="w-10 py-3 px-2 text-center">
                    <span className="sr-only">{t("dashboardColSelect")}</span>
                  </th>
                  <th
                    className="text-left py-3 px-3 font-medium"
                    aria-sort={sortAriaSort("model")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("model")}
                      className="group inline-flex w-full min-w-0 items-center justify-start gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                      title={t("contentInsightsSortClickColumn")}
                    >
                      <span className={cn(sortKey === "model" && "text-foreground")}>{t("contentInsightsColModel")}</span>
                      {renderSortIcon("model")}
                    </button>
                  </th>
                  <th
                    className="text-left py-3 px-3 font-medium"
                    aria-sort={sortAriaSort("type")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("type")}
                      className="group inline-flex w-full min-w-0 items-center justify-start gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                      title={t("contentInsightsSortClickColumn")}
                    >
                      <span className={cn(sortKey === "type" && "text-foreground")}>{t("contentInsightsColType")}</span>
                      {renderSortIcon("type")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("thumb_opens")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("thumb_opens")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                      title={t("contentInsightsSortClickColumn")}
                    >
                      <span className={cn(sortKey === "thumb_opens" && "text-foreground")}>{t("contentInsightsColOpens")}</span>
                      {renderSortIcon("thumb_opens")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("detail_views")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("detail_views")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                      title={t("contentInsightsSortClickColumn")}
                    >
                      <span className={cn(sortKey === "detail_views" && "text-foreground")}>{t("contentInsightsColDetailViews")}</span>
                      {renderSortIcon("detail_views")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("first")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("first")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                      title={t("contentInsightsSortClickColumn")}
                    >
                      <span className={cn(sortKey === "first" && "text-foreground")}>{t("contentInsightsColFirst")}</span>
                      {renderSortIcon("first")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("watch")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("watch")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                      title={t("contentInsightsSortClickColumn")}
                    >
                      <span className={cn(sortKey === "watch" && "text-foreground")}>{t("contentInsightsColWatch")}</span>
                      {renderSortIcon("watch")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium tabular-nums"
                    aria-sort={sortAriaSort("avg")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("avg")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                      title={t("contentInsightsSortClickColumn")}
                    >
                      <span className={cn(sortKey === "avg" && "text-foreground")}>{t("contentInsightsColAvg")}</span>
                      {renderSortIcon("avg")}
                    </button>
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium"
                    aria-sort={sortAriaSort("source")}
                  >
                    <button
                      type="button"
                      onClick={() => handleSortColumn("source")}
                      className="group inline-flex w-full min-w-0 items-center justify-end gap-1.5 rounded-lg px-1 py-0.5 -mx-1 text-right transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                      title={t("contentInsightsSortClickColumn")}
                    >
                      <span className={cn(sortKey === "source" && "text-foreground")}>{t("contentInsightsColSource")}</span>
                      {renderSortIcon("source")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.contentItemId}
                    className="border-b border-border/40 hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="py-2.5 px-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border accent-violet-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                        checked={selected.has(row.contentItemId)}
                        disabled={row.canExportZip !== true}
                        onChange={() => toggleSelect(row.contentItemId, row.canExportZip === true)}
                        aria-label={t("dashboardColSelect")}
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium">{row.modelFolderName}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">
                        {row.contentItemId}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">{row.contentType}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{row.thumbOpens}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{row.detailViews}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {row.contentType === "PHOTO" ? row.photoFirstViews : row.firstPlays}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{fmtSec(row.totalWatchSeconds)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                      {row.engagementSessions > 0 ? fmtSec(row.avgWatchSeconds) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {row.hasSourceFile ? (
                        <a
                          href={`/api/admin/content/${row.contentItemId}/source-download`}
                          className="inline-flex items-center gap-1 text-violet-400 hover:underline text-xs font-medium"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {t("contentInsightsDownload")}
                        </a>
                      ) : row.canExportZip === true ? (
                        <span className="text-xs text-muted-foreground">{t("dashboardPhotoOnlyZip")}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{t("contentInsightsFootnote")}</p>
      <p className="text-xs text-muted-foreground/80">{t("dashboardZipHint")}</p>
    </div>
  );
}
