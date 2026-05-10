"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { formatPrice } from "@/lib/utils";
import type { StatsPayload } from "@/components/admin/payments-dashboard";

export function RevenueSplitBar({ statsSince }: { statsSince: StatsPayload }) {
  const t = useTranslations("admin.payments");
  const reduceMotion = useReducedMotion();

  const { myPct, partnerPct, caption } = useMemo(() => {
    if (!statsSince || typeof statsSince !== "object") {
      return { myPct: 50, partnerPct: 50, caption: t("evenSplit") };
    }
    const split = (statsSince as { split?: Record<string, unknown> }).split ?? {};
    const my = Number(split.myCollected ?? 0);
    const partner = Number(split.partnerCollected ?? 0);
    const total = my + partner;
    if (total <= 0) {
      return { myPct: 50, partnerPct: 50, caption: t("evenSplit") };
    }
    const mp = (my / total) * 100;
    const pp = (partner / total) * 100;
    const owed = Number(split.owedToMe ?? 0);
    let cap = t("evenSplit");
    if (Math.abs(owed) >= 0.01) {
      cap =
        owed > 0
          ? t("partnerOwesYou", { amount: formatPrice(owed) })
          : t("youOwePartner", { amount: formatPrice(Math.abs(owed)) });
    }
    return { myPct: mp, partnerPct: pp, caption: cap };
  }, [statsSince, t]);

  return (
    <section className="rounded-2xl border border-white/[0.08] p-4 sm:p-5 bg-card/30 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{t("sinceLastSettlement")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{caption}</p>
        </div>
        <div className="text-xs text-muted-foreground flex gap-4">
          <span>{t("mySplit")}</span>
          <span>{t("partnerSplit")}</span>
        </div>
      </div>
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-white/[0.06] ring-1 ring-white/[0.06]">
        <motion.div
          className="h-full shrink-0 bg-gradient-to-r from-violet-500 to-fuchsia-500"
          initial={reduceMotion ? false : { width: "0%" }}
          animate={{ width: `${myPct}%` }}
          transition={{ type: "spring", stiffness: 280, damping: 26 }}
        />
        <motion.div
          className="h-full shrink-0 bg-gradient-to-r from-cyan-500 to-emerald-400"
          initial={reduceMotion ? false : { width: "0%" }}
          animate={{ width: `${partnerPct}%` }}
          transition={{ type: "spring", stiffness: 280, damping: 26, delay: reduceMotion ? 0 : 0.05 }}
        />
      </div>
    </section>
  );
}
