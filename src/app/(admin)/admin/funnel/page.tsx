"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  TrendingUp,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

/** Keys shown in aggregate cards (aligned with backend funnel summary). */
const GROUP_CORE = [
  "session_start",
  "signup_completed",
  "checkout_started",
  "purchase_completed",
  "purchase_created",
  "credits_credited",
] as const;

const GROUP_ENGAGEMENT = ["catalog_viewed", "model_page_viewed", "video_play_started"] as const;

const GROUP_RISK = [
  "checkout_abandoned",
  "signup_failed",
  "purchase_api_error",
  "payment_abandoned",
  "payment_failed",
  "login_failed",
  "logout",
] as const;

function eventTone(name: string): "core" | "engagement" | "risk" {
  if ((GROUP_ENGAGEMENT as readonly string[]).includes(name)) return "engagement";
  if ((GROUP_RISK as readonly string[]).includes(name)) return "risk";
  return "core";
}

function toneClasses(tone: "core" | "engagement" | "risk") {
  switch (tone) {
    case "engagement":
      return "border-emerald-500/25 bg-emerald-500/[0.07] shadow-[inset_0_1px_0_0_rgba(16,185,129,0.12)]";
    case "risk":
      return "border-amber-500/25 bg-amber-500/[0.07] shadow-[inset_0_1px_0_0_rgba(245,158,11,0.12)]";
    default:
      return "border-primary/20 bg-primary/[0.06] shadow-[inset_0_1px_0_0_rgba(124,58,237,0.15)]";
  }
}

function MetricTile({
  name,
  value,
}: {
  name: string;
  value: number;
}) {
  const tone = eventTone(name);
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors hover:border-white/10",
        toneClasses(tone),
      )}
    >
      <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground/90 truncate" title={name}>
        {name}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function RateBarRow({
  label,
  rate,
  fmtPct,
}: {
  label: string;
  rate: number | undefined;
  fmtPct: (x: number | undefined) => string;
}) {
  const reduceMotion = useReducedMotion();
  const pct = rate == null || Number.isNaN(rate) ? null : Math.min(100, Math.max(0, rate * 100));

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground leading-snug">{label}</span>
        <span className="font-mono tabular-nums text-foreground shrink-0">{fmtPct(rate)}</span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden ring-1 ring-white/[0.04]">
        {pct != null && (
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary/90 via-primary to-violet-500/90"
            initial={reduceMotion ? false : { width: "0%" }}
            animate={{ width: `${pct}%` }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 120, damping: 24, mass: 0.85 }
            }
          />
        )}
      </div>
    </div>
  );
}

function DayCountsCell({ counts, emptyLabel }: { counts: Record<string, number>; emptyLabel: string }) {
  const entries = useMemo(
    () =>
      Object.entries(counts)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]),
    [counts],
  );

  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground italic">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 max-w-[min(100vw-6rem,52rem)]">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className={cn(
            "inline-flex items-baseline gap-1.5 rounded-lg border px-2 py-1 text-[11px] leading-none",
            toneClasses(eventTone(k)),
          )}
        >
          <span className="font-mono text-muted-foreground truncate max-w-[10rem]" title={k}>
            {k}
          </span>
          <span className="tabular-nums font-semibold text-foreground">{v}</span>
        </span>
      ))}
    </div>
  );
}

function PropsCell({
  props,
  t,
}: {
  props: Record<string, unknown>;
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => JSON.stringify(props, null, 2), [props]);
  const oneLine = useMemo(() => JSON.stringify(props), [props]);
  const preview = oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-w-0 max-w-xl">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          {!open ? (
            <p className="text-[11px] font-mono text-muted-foreground leading-relaxed break-all">{preview}</p>
          ) : (
            <pre className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all max-h-48 overflow-y-auto rounded-lg border border-white/[0.08] bg-black/30 p-3">
              {pretty}
            </pre>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px] px-2" onClick={() => setOpen((o) => !o)}>
              {open ? t("growthEventCollapse") : t("growthEventExpand")}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-[11px] px-2 gap-1" onClick={copy}>
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copied ? t("growthEventCopied") : t("growthEventCopyJson")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

  const periodTotal = useMemo(() => {
    if (!summary?.totals) return 0;
    return Object.values(summary.totals).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  }, [summary]);

  return (
    <div className="space-y-8 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1 pb-8">
      {/* Summary */}
      <section className="rounded-2xl border border-white/[0.07] bg-card/80 backdrop-blur-sm overflow-hidden shadow-xl shadow-black/20">
        <div className="relative border-b border-white/[0.06] bg-gradient-to-br from-primary/[0.08] via-transparent to-violet-600/[0.05] px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
                <TrendingUp className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{t("growthFunnelSummaryTitle")}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("growthFunnelTotalEvents")}:{" "}
                  <span className="font-mono tabular-nums text-foreground">{periodTotal}</span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("growthFunnelPeriod")}</span>
              <select
                className="h-9 rounded-lg border border-border bg-background/80 px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", summaryLoading && "animate-spin")} />
                {t("growthFunnelRefresh")}
              </Button>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-8">
          {summaryLoading && !summary ? (
            <p className="text-sm text-muted-foreground">{t("growthFunnelLoading")}</p>
          ) : summary ? (
            <>
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                    {t("growthFunnelGroupCore")}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
                    {GROUP_CORE.map((key) => (
                      <MetricTile key={key} name={key} value={summary.totals[key] ?? 0} />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                    {t("growthFunnelGroupEngagement")}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {GROUP_ENGAGEMENT.map((key) => (
                      <MetricTile key={key} name={key} value={summary.totals[key] ?? 0} />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                    {t("growthFunnelGroupRisk")}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {GROUP_RISK.map((key) => (
                      <MetricTile key={key} name={key} value={summary.totals[key] ?? 0} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-muted/20 p-4 space-y-4">
                <p className="text-sm font-medium flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(124,58,237,0.8)]" />
                  {t("growthFunnelRates")}
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 max-w-2xl">
                  <RateBarRow
                    label={t("growthFunnelRateLabelSignupSession")}
                    rate={summary.rates?.signup_per_session}
                    fmtPct={fmtPct}
                  />
                  <RateBarRow
                    label={t("growthFunnelRateLabelCheckoutSession")}
                    rate={summary.rates?.checkout_per_session}
                    fmtPct={fmtPct}
                  />
                  <RateBarRow
                    label={t("growthFunnelRateLabelPurchaseSession")}
                    rate={summary.rates?.purchase_per_session}
                    fmtPct={fmtPct}
                  />
                  <RateBarRow
                    label={t("growthFunnelRateLabelCheckoutSignup")}
                    rate={summary.rates?.checkout_per_signup}
                    fmtPct={fmtPct}
                  />
                  <RateBarRow
                    label={t("growthFunnelRateLabelPurchaseCheckout")}
                    rate={summary.rates?.purchase_per_checkout}
                    fmtPct={fmtPct}
                  />
                </div>
              </div>

              {summary.byDay && summary.byDay.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-3">{t("growthFunnelByDay")}</p>
                  <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left">
                          <th className="py-3 px-3 font-medium w-36 align-top">{t("growthFunnelDate")}</th>
                          <th className="py-3 px-3 font-medium align-top">{t("growthFunnelEventCounts")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.byDay.map((row) => (
                          <tr key={row.date} className="border-b border-border/40 last:border-0">
                            <td className="py-3 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap align-top">
                              {row.date}
                            </td>
                            <td className="py-3 px-3 align-top">
                              <DayCountsCell counts={row.counts} emptyLabel={t("growthFunnelDayNoActivity")} />
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
      </section>

      {/* Live events */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.08]">
              <Activity className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("funnelEventsPageTitle")}</h1>
              <p className="text-sm text-muted-foreground mt-0.5 max-w-prose">{t("growthEventsHint")}</p>
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
              className="w-full sm:w-64 h-9 text-sm bg-background/50"
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

        <div className="rounded-2xl border border-white/[0.07] bg-card/80 overflow-hidden shadow-lg shadow-black/15">
          {error && (
            <p className="px-5 py-3 text-sm text-destructive border-b border-border bg-destructive/5">{error}</p>
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
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left py-3 px-4 font-medium whitespace-nowrap">{t("growthEventTime")}</th>
                      <th className="text-left py-3 px-4 font-medium">{t("growthEventName")}</th>
                      <th className="text-left py-3 px-4 font-medium min-w-[120px]">{t("growthEventUserId")}</th>
                      <th className="text-left py-3 px-4 font-medium min-w-[220px]">{t("growthEventPropsShort")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => {
                      const tone = eventTone(ev.eventName);
                      return (
                        <tr key={ev.id} className="border-b border-border/50 hover:bg-muted/25 transition-colors align-top">
                          <td className="py-3 px-4 text-muted-foreground whitespace-nowrap text-xs align-top">
                            {new Date(ev.createdAt).toLocaleString()}
                          </td>
                          <td className="py-3 px-4 align-top">
                            <span
                              className={cn(
                                "inline-flex max-w-[14rem] rounded-lg border px-2 py-1 font-mono text-[11px] leading-tight",
                                toneClasses(tone),
                              )}
                            >
                              {ev.eventName}
                            </span>
                          </td>
                          <td
                            className="py-3 px-4 font-mono text-[11px] text-muted-foreground max-w-[160px] truncate align-top"
                            title={ev.userId ?? ""}
                          >
                            {ev.userId ?? "—"}
                          </td>
                          <td className="py-3 px-4 align-top">
                            <PropsCell props={ev.props} t={t} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-muted/25">
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
                      {t("growthEventsPrev")}
                    </Button>
                    <span className="text-sm tabular-nums min-w-[4rem] text-center text-muted-foreground">
                      {page + 1} / {Math.ceil(total / PAGE_SIZE) || 1}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(page + 1) * PAGE_SIZE >= total}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {t("growthEventsNext")}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
