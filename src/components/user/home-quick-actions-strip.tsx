"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Coins, Heart, LayoutDashboard, ShoppingCart } from "lucide-react";
import { formatCredits } from "@/lib/utils";

type HomeQuickActionsStripProps = {
  isAuthenticated: boolean;
  creditBalance: number;
};

export function HomeQuickActionsStrip({ isAuthenticated, creditBalance }: HomeQuickActionsStripProps) {
  const tNav = useTranslations("nav");
  const tModels = useTranslations("models");

  if (!isAuthenticated) {
    return (
      <section className="mb-6 rounded-2xl border border-white/[0.08] bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/purchase"
            className="flex min-h-[56px] items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 hover:bg-white/[0.05] transition-colors"
          >
            <span className="font-medium">{tNav("buyCredits")}</span>
            <Coins className="h-4 w-4 text-primary" />
          </Link>
          <Link
            href="/login"
            className="flex min-h-[56px] items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 hover:bg-white/[0.05] transition-colors"
          >
            <span className="font-medium">{tModels("signInToPurchase")}</span>
            <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/purchase"
          className="flex min-h-[64px] items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 hover:bg-white/[0.05] transition-colors"
        >
          <span className="text-sm font-medium">{tNav("buyCredits")}</span>
          <Coins className="h-4 w-4 text-primary" />
        </Link>

        <Link
          href="/my-purchases"
          className="flex min-h-[64px] items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 hover:bg-white/[0.05] transition-colors"
        >
          <span className="text-sm font-medium">{tNav("myPurchases")}</span>
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
        </Link>

        <Link
          href="/favorites"
          className="flex min-h-[64px] items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 hover:bg-white/[0.05] transition-colors"
        >
          <span className="text-sm font-medium">{tNav("favorites")}</span>
          <Heart className="h-4 w-4 text-muted-foreground" />
        </Link>

        <Link
          href="/dashboard"
          className="flex min-h-[64px] items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 hover:bg-white/[0.05] transition-colors"
        >
          <span className="text-sm font-medium">{tNav("dashboard")}</span>
          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
    </section>
  );
}
