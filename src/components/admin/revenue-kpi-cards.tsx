"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { Calendar, CalendarDays, History, Sparkles } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { StatsPayload } from "@/components/admin/payments-dashboard";
import { cn } from "@/lib/utils";

function pickApproved(s: StatsPayload): { amount: number; count: number } {
  if (!s || typeof s !== "object") return { amount: 0, count: 0 };
  const app = (s as { approved?: { totalAmount?: number; count?: number } }).approved;
  return { amount: Number(app?.totalAmount ?? 0), count: Number(app?.count ?? 0) };
}

function pickComparison(s: StatsPayload): { amount: number; count: number } {
  if (!s || typeof s !== "object") return { amount: 0, count: 0 };
  const c = (s as { comparison?: { approvedTotal?: number; approvedCount?: number } }).comparison;
  return { amount: Number(c?.approvedTotal ?? 0), count: Number(c?.approvedCount ?? 0) };
}

export function RevenueKpiCards({
  statsToday,
  stats7d,
  stats30d,
  statsSince,
}: {
  statsToday: StatsPayload;
  stats7d: StatsPayload;
  stats30d: StatsPayload;
  statsSince: StatsPayload;
}) {
  const t = useTranslations("admin.payments");
  const reduceMotion = useReducedMotion();

  const cards = useMemo(
    () => [
      { key: "today", label: t("today"), icon: Calendar, stats: statsToday },
      { key: "7d", label: t("last7Days"), icon: CalendarDays, stats: stats7d },
      { key: "30d", label: t("last30Days"), icon: Sparkles, stats: stats30d },
      { key: "since", label: t("sinceLastSettlement"), icon: History, stats: statsSince },
    ],
    [t, statsToday, stats7d, stats30d, statsSince],
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ key, label, icon: Icon, stats }, i) => {
        const cur = pickApproved(stats);
        const prev = pickComparison(stats);
        const delta = cur.amount - prev.amount;
        const pos = delta >= 0;
        return (
          <motion.article
            key={key}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduceMotion ? 0 : i * 0.05, type: "spring", stiffness: 420, damping: 28 }}
            className={cn(
              "relative overflow-hidden rounded-2xl border border-white/[0.08] p-4",
              "bg-gradient-to-br from-card via-card to-primary/[0.06]",
              "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
            )}
            aria-label={t("ariaKpiRange", { range: label })}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
              <Icon className="h-4 w-4 text-primary/80" />
            </div>
            <motion.p
              className="text-2xl sm:text-3xl font-bold tabular-nums tracking-tight"
              initial={reduceMotion ? false : { scale: 0.92 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
            >
              {formatPrice(cur.amount)}
            </motion.p>
            <p className="text-xs text-muted-foreground mt-1">
              {cur.count} {t("approved").toLowerCase()}
            </p>
            <div
              className={cn(
                "mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                pos ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400",
              )}
            >
              <span>{pos ? "▲" : "▼"}</span>
              <span>{formatPrice(Math.abs(delta))}</span>
              <span className="text-muted-foreground font-normal">vs prev.</span>
            </div>
            <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
          </motion.article>
        );
      })}
    </div>
  );
}
