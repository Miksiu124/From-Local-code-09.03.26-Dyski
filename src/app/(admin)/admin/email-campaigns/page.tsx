"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmailStatRow = {
  campaign: string;
  sends: number;
  clicks: number;
  uniqueClickers: number;
  conversions: number;
  ctr: number;
  conversionRate: number;
};

type StatsPayload = {
  days: number;
  since: string;
  rows: EmailStatRow[];
};

const DAY_OPTIONS = [7, 30, 90] as const;

export default function AdminEmailCampaignsPage() {
  const t = useTranslations("admin.emailCampaigns");
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingPriceUpdate, setSendingPriceUpdate] = useState(false);
  const [priceUpdateStatus, setPriceUpdateStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/marketing/email-stats?days=${days}`, { credentials: "include" });
      if (!res.ok) {
        const txt = await res.text();
        setError(txt || res.statusText);
        setData(null);
        return;
      }
      const json = (await res.json()) as StatsPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendPriceUpdate = useCallback(async () => {
    setSendingPriceUpdate(true);
    setPriceUpdateStatus(null);
    try {
      const res = await fetch("/api/admin/marketing/price-update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, limit: 800 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPriceUpdateStatus(data.message || data.error || "Failed to send campaign");
        return;
      }
      setPriceUpdateStatus(
        `Price update campaign finished: sent=${data.sent ?? 0}, failed=${data.failed ?? 0}`,
      );
      await load();
    } catch (e) {
      setPriceUpdateStatus(e instanceof Error ? e.message : "Failed to send campaign");
    } finally {
      setSendingPriceUpdate(false);
    }
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            <Mail className="h-6 w-6 text-muted-foreground" aria-hidden />
            {t("title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p>
          {data?.since && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("sinceLabel")}: {data.since}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {DAY_OPTIONS.map((d) => (
            <Button
              key={d}
              type="button"
              variant={days === d ? "default" : "outline"}
              size="sm"
              className={cn(days === d && "pointer-events-none")}
              onClick={() => setDays(d)}
            >
              {d} {t("daysSuffix")}
            </Button>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} aria-hidden />
            {t("refresh")}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void sendPriceUpdate()}
            disabled={sendingPriceUpdate}
          >
            <RefreshCw className={cn("mr-1.5 h-4 w-4", sendingPriceUpdate && "animate-spin")} aria-hidden />
            Send price update
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {priceUpdateStatus && (
        <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm text-foreground/90">
          {priceUpdateStatus}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-card/40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/[0.08] bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t("colCampaign")}</th>
                <th className="px-4 py-3 font-medium tabular-nums">{t("colSends")}</th>
                <th className="px-4 py-3 font-medium tabular-nums">{t("colClicks")}</th>
                <th className="px-4 py-3 font-medium tabular-nums">{t("colUniqueClickers")}</th>
                <th className="px-4 py-3 font-medium tabular-nums">{t("colConversions")}</th>
                <th className="px-4 py-3 font-medium tabular-nums">{t("colCtr")}</th>
                <th className="px-4 py-3 font-medium tabular-nums">{t("colConvRate")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data?.rows?.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    {t("loading")}
                  </td>
                </tr>
              ) : !data?.rows?.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                data.rows.map((r) => (
                  <tr key={r.campaign} className="border-b border-white/[0.05] last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-3 font-mono text-xs text-foreground/90">{r.campaign}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.sends}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.clicks}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.uniqueClickers}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.conversions}</td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {(r.ctr * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {(r.conversionRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{t("footnote")}</p>
    </div>
  );
}
