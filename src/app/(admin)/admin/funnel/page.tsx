"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type GrowthEventRow = {
  id: string;
  eventName: string;
  userId: string | null;
  props: Record<string, unknown>;
  createdAt: string;
};

const PAGE_SIZE = 25;

type FunnelSummary = {
  days: number;
  totals: Record<string, number>;
  rates: Record<string, number>;
  byDay: { date: string; counts: Record<string, number> }[];
};

export default function AdminFunnelEventsPage() {
  const t = useTranslations("admin");
  const [events, setEvents] = useState<GrowthEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filterApplied, setFilterApplied] = useState("");
  const [page, setPage] = useState(0);
  const [funnelDays, setFunnelDays] = useState(7);
  const [summary, setSummary] = useState<FunnelSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/admin/growth-funnel?days=${funnelDays}`, { credentials: "include" });
      if (!res.ok) {
        setSummary(null);
        return;
      }
      const j = (await res.json()) as FunnelSummary;
      setSummary(j);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [funnelDays]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        });
        if (filterApplied.trim()) params.set("event", filterApplied.trim());
        const res = await fetch(`/api/admin/growth-events?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) {
            setError(t("growthEventsLoadFailed"));
            setEvents([]);
            setTotal(0);
          }
          return;
        }
        const j = (await res.json()) as { events?: GrowthEventRow[]; total?: number };
        if (cancelled) return;
        const raw = Array.isArray(j.events) ? j.events : [];
        setEvents(
          raw.map((row) => ({
            ...row,
            props:
              row.props && typeof row.props === "object" && row.props !== null
                ? (row.props as Record<string, unknown>)
                : {},
          })),
        );
        setTotal(typeof j.total === "number" ? j.total : 0);
      } catch {
        if (!cancelled) {
          setError(t("growthEventsLoadFailed"));
          setEvents([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, filterApplied, t]);

  const fmtPct = (x: number | undefined) =>
    x == null || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1">
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("growthFunnelSummaryTitle")}</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("growthFunnelPeriod")}</span>
            <select
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={funnelDays}
              onChange={(e) => setFunnelDays(Number(e.target.value))}
            >
              {[7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {d} {t("growthFunnelDays")}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" size="sm" onClick={() => fetchSummary()} disabled={summaryLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${summaryLoading ? "animate-spin" : ""}`} />
              {t("growthFunnelRefresh")}
            </Button>
          </div>
        </div>
        {summaryLoading && !summary ? (
          <p className="text-sm text-muted-foreground">{t("growthFunnelLoading")}</p>
        ) : summary ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
              {[
                "session_start",
                "signup_completed",
                "checkout_started",
                "purchase_completed",
                "catalog_viewed",
                "model_page_viewed",
                "video_play_started",
                "checkout_abandoned",
                "signup_failed",
                "purchase_created",
                "credits_credited",
                "purchase_api_error",
                "payment_abandoned",
                "payment_failed",
                "login_failed",
                "logout",
              ].map((key) => (
                <div key={key} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                  <p className="text-[11px] font-mono text-muted-foreground truncate" title={key}>
                    {key}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">{summary.totals[key] ?? 0}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium mb-2">{t("growthFunnelRates")}</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  signup / session: <span className="text-foreground font-mono">{fmtPct(summary.rates?.signup_per_session)}</span>
                </li>
                <li>
                  checkout / session: <span className="text-foreground font-mono">{fmtPct(summary.rates?.checkout_per_session)}</span>
                </li>
                <li>
                  purchase / session: <span className="text-foreground font-mono">{fmtPct(summary.rates?.purchase_per_session)}</span>
                </li>
                <li>
                  checkout / signup: <span className="text-foreground font-mono">{fmtPct(summary.rates?.checkout_per_signup)}</span>
                </li>
                <li>
                  purchase / checkout: <span className="text-foreground font-mono">{fmtPct(summary.rates?.purchase_per_checkout)}</span>
                </li>
              </ul>
            </div>
            {summary.byDay && summary.byDay.length > 0 && (
              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium mb-2">{t("growthFunnelByDay")}</p>
                <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-lg border border-border/60">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left">
                        <th className="py-2 px-2 font-medium">{t("growthFunnelDate")}</th>
                        <th className="py-2 px-2 font-medium">{t("growthFunnelEventCounts")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byDay.map((row) => (
                        <tr key={row.date} className="border-b border-border/40 align-top">
                          <td className="py-1.5 px-2 font-mono whitespace-nowrap">{row.date}</td>
                          <td className="py-1.5 px-2">
                            <pre className="text-[11px] leading-snug whitespace-pre-wrap break-all">
                              {JSON.stringify(row.counts)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-destructive">{t("growthFunnelLoadFailed")}</p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">{t("funnelEventsPageTitle")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("growthEventsHint")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder={t("growthEventsFilter")}
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(0);
                setFilterApplied(filterInput.trim());
              }
            }}
            className="w-full sm:w-56 h-9 text-sm"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setPage(0);
              setFilterApplied(filterInput.trim());
            }}
          >
            {t("growthEventsApply")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPage(0);
              setFilterInput("");
              setFilterApplied("");
            }}
          >
            {t("growthEventsClear")}
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {error && (
          <p className="px-5 py-3 text-sm text-destructive border-b border-border">{error}</p>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            {t("retryAnalytics")}
          </div>
        ) : !error && events.length === 0 ? (
          <p className="px-5 py-12 text-muted-foreground text-sm text-center">{t("growthEventsEmpty")}</p>
        ) : error ? null : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left py-3 px-4 font-medium">{t("growthEventTime")}</th>
                    <th className="text-left py-3 px-4 font-medium">{t("growthEventName")}</th>
                    <th className="text-left py-3 px-4 font-medium">{t("growthEventUserId")}</th>
                    <th className="text-left py-3 px-4 font-medium min-w-[200px]">{t("growthEventProps")}</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} className="border-b border-border/50 hover:bg-muted/30 align-top">
                      <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap text-xs">
                        {new Date(ev.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs">{ev.eventName}</td>
                      <td
                        className="py-2.5 px-4 font-mono text-[11px] text-muted-foreground max-w-[140px] truncate"
                        title={ev.userId ?? ""}
                      >
                        {ev.userId ?? "—"}
                      </td>
                      <td className="py-2.5 px-4">
                        <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all max-h-32 overflow-y-auto bg-black/20 rounded-lg p-2 border border-white/[0.06]">
                          {JSON.stringify(ev.props, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-muted/30">
                <span className="text-sm text-muted-foreground">
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-sm tabular-nums min-w-[4rem] text-center">
                    {page + 1} / {Math.ceil(total / PAGE_SIZE) || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * PAGE_SIZE >= total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
