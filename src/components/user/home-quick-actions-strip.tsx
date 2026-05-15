"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { formatCredits } from "@/lib/utils";

type HomeQuickActionsStripProps = {
  isAuthenticated: boolean;
  creditBalance: number;
};

export function HomeQuickActionsStrip({ isAuthenticated, creditBalance }: HomeQuickActionsStripProps) {
  const tNav = useTranslations("nav");
  const tModels = useTranslations("models");

  const actionCardClass =
    "flex min-h-[64px] min-w-[220px] items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-medium hover:bg-white/[0.05] transition-colors sm:min-w-0";

  if (!isAuthenticated) {
    return (
      <section className="mb-6 rounded-2xl border border-white/[0.08] bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/purchase"
            className="flex min-h-[56px] items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 font-medium hover:bg-white/[0.05] transition-colors"
          >
            <span>{tNav("buyCredits")}</span>
          </Link>
          <Link
            href="/login"
            className="flex min-h-[56px] items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 font-medium hover:bg-white/[0.05] transition-colors"
          >
            <span>{tModels("signInToPurchase")}</span>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-2xl border border-white/[0.08] bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground/90">{tNav("dashboard")}</h2>
        <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium">
          <Coins className="h-3.5 w-3.5 text-primary" />
          {formatCredits(creditBalance)}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/my-purchases" className={actionCardClass}>
          {tNav("myPurchases")}
        </Link>

        <Link href="/favorites" className={actionCardClass}>
          {tNav("favorites")}
        </Link>

        <Link href="/referral" className={actionCardClass}>
          {tNav("referral")}
        </Link>

        <Link
          href="/custom-orders"
          className={actionCardClass}
        >
          {tNav("customOrders")}
        </Link>

        <Link
          href="/games/coinflip"
          className={actionCardClass}
        >
          {tNav("coinflip")}
        </Link>
      </div>
    </section>
  );
}
