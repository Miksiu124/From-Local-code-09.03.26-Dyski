"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import {
  MousePointerClick,
  Users,
  ShoppingBag,
  Coins,
  Banknote,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { formatCredits } from "@/lib/utils";

type ReferralStats = {
  totalReferred: number;
  totalPurchased: number;
  totalCreditsEarned: number;
  clicks: number;
  revenue: number;
};

type DailyClick = { date: string; count: number };

type ReferralPayload = {
  referralCode: string;
  stats: ReferralStats;
  dailyClicks?: DailyClick[];
};

function parsePayload(raw: unknown): ReferralPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const code = o.referralCode;
  if (typeof code !== "string" || !code.trim()) return null;
  const statsRaw = o.stats && typeof o.stats === "object" ? (o.stats as Record<string, unknown>) : {};
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  let dailyClicks: DailyClick[] | undefined;
  if (Array.isArray(o.dailyClicks) && o.dailyClicks.length > 0) {
    dailyClicks = o.dailyClicks
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const date = typeof r.date === "string" ? r.date : "";
        const count = typeof r.count === "number" ? r.count : Number(r.count);
        if (!date || Number.isNaN(count)) return null;
        return { date, count: Math.max(0, Math.floor(count)) };
      })
      .filter((x): x is DailyClick => x !== null);
    if (dailyClicks.length === 0) dailyClicks = undefined;
  }
  return {
    referralCode: code.trim(),
    stats: {
      totalReferred: Math.max(0, Math.floor(num(statsRaw.totalReferred))),
      totalPurchased: Math.max(0, Math.floor(num(statsRaw.totalPurchased))),
      totalCreditsEarned: Math.max(0, Math.floor(num(statsRaw.totalCreditsEarned))),
      clicks: Math.max(0, Math.floor(num(statsRaw.clicks))),
      revenue: Math.max(0, num(statsRaw.revenue)),
    },
    dailyClicks,
  };
}

const tileEase = [0.22, 1, 0.36, 1] as const;

type Props = {
  userId: string;
};

export function AdminUserReferralStatus({ userId }: Props) {
  const tAdmin = useTranslations("admin");
  const tr = useTranslations("referral");
  const reduceMotion = useReducedMotion();
  const [data, setData] = useState<ReferralPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/referral`, {
        credentials: "include",
      });
      if (!res.ok) {
        setData(null);
        setFailed(true);
        return;
      }
      const raw: unknown = await res.json();
      const parsed = parsePayload(raw);
      setData(parsed);
      if (!parsed) setFailed(true);
    } catch {
      setData(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const statTileClass =
    "rounded-lg border border-border/60 bg-secondary/40 p-3 sm:p-4 transition-[box-shadow,border-color] duration-200 hover:border-primary/25 hover:shadow-md motion-reduce:transition-none";

  const containerVariants = {
    hidden: reduceMotion ? {} : { opacity: 0 },
    show: {
      opacity: 1,
      transition: reduceMotion
        ? { duration: 0 }
        : { staggerChildren: 0.06, delayChildren: 0.04, ease: tileEase },
    },
  };

  const itemVariants = {
    hidden: reduceMotion ? {} : { opacity: 0, y: 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: reduceMotion ? { duration: 0 } : { duration: 0.4, ease: tileEase },
    },
  };

  return (
    <section
      aria-labelledby="admin-user-referral-heading"
      className="rounded-xl border border-primary/20 bg-secondary/30 p-4 shadow-sm shadow-black/10"
    >
      <div className="mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <h3 id="admin-user-referral-heading" className="text-sm font-semibold text-foreground">
          {tAdmin("referralStatus")}
        </h3>
      </div>

      {loading && (
        <div className="space-y-3" aria-busy="true">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[4.5rem] animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        </div>
      )}

      {!loading && failed && (
        <p className="text-sm text-muted-foreground">{tAdmin("referralLoadError")}</p>
      )}

      {!loading && data && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="space-y-4"
        >
          <motion.p variants={itemVariants} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/90">{tr("codeLabel")}:</span>{" "}
            <code className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[11px] tracking-wide">
              {data.referralCode}
            </code>
          </motion.p>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <motion.div variants={itemVariants} className={statTileClass}>
              <MousePointerClick className="mb-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <p className="text-lg font-semibold tabular-nums sm:text-xl">{data.stats.clicks}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">{tr("clicks")}</p>
            </motion.div>
            <motion.div variants={itemVariants} className={statTileClass}>
              <Users className="mb-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <p className="text-lg font-semibold tabular-nums sm:text-xl">{data.stats.totalReferred}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">{tr("totalReferred")}</p>
            </motion.div>
            <motion.div variants={itemVariants} className={statTileClass}>
              <ShoppingBag className="mb-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <p className="text-lg font-semibold tabular-nums sm:text-xl">{data.stats.totalPurchased}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">{tr("totalPurchased")}</p>
            </motion.div>
            <motion.div variants={itemVariants} className={statTileClass}>
              <Coins className="mb-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatCredits(data.stats.totalCreditsEarned)}
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">{tr("totalCreditsEarned")}</p>
            </motion.div>
            <motion.div variants={itemVariants} className={`${statTileClass} col-span-2 sm:col-span-1`}>
              <Banknote className="mb-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {data.stats.revenue.toFixed(2)}
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {tr("revenue")} PLN
              </p>
            </motion.div>
          </div>

          {data.dailyClicks && data.dailyClicks.length > 0 && (
            <motion.div variants={itemVariants} className="border-t border-border/40 pt-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
                {tr("clicksLast7Days")}
              </p>
              <div
                className="flex h-[5.5rem] w-full items-end gap-1"
                role="img"
                aria-label={tr("clicksLast7Days")}
              >
                {data.dailyClicks.map((d, i) => {
                  const maxCount = Math.max(...data.dailyClicks!.map((x) => x.count), 1);
                  const heightPct = Math.max((d.count / maxCount) * 100, 6);
                  return (
                    <div
                      key={`${d.date}-${i}`}
                      className="group flex min-w-0 flex-1 flex-col items-center justify-end"
                      title={`${d.date}: ${d.count}`}
                    >
                      <motion.div
                        className="w-full rounded-t bg-primary/35 motion-reduce:bg-primary/45"
                        style={{
                          height: `${heightPct}%`,
                          minHeight: 4,
                          transformOrigin: "bottom center",
                        }}
                        initial={reduceMotion ? false : { scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : { delay: i * 0.055, duration: 0.52, ease: [...tileEase] }
                        }
                      />
                      <span className="mt-1 w-full truncate text-center text-[10px] text-muted-foreground tabular-nums">
                        {d.date.length >= 5 ? d.date.slice(5) : d.date}
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </section>
  );
}
