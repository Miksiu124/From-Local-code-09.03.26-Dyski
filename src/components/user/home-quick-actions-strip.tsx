"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Coins, Gamepad2, Heart, ShoppingCart, UserPlus } from "lucide-react";
import { formatCredits } from "@/lib/utils";

type HomeQuickActionsStripProps = {
  isAuthenticated: boolean;
  creditBalance: number;
};

export function HomeQuickActionsStrip({ isAuthenticated, creditBalance }: HomeQuickActionsStripProps) {
  const tNav = useTranslations("nav");
  const tModels = useTranslations("models");

  const actionCardClass =
    "flex min-h-[52px] items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-center text-xs font-medium hover:bg-white/[0.05] transition-colors sm:min-h-[56px] sm:gap-2 sm:text-sm";

  if (!isAuthenticated) {
    return (
      <section className="mb-6 rounded-2xl border border-white/[0.08] bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/purchase"
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-center text-sm font-medium hover:bg-white/[0.05] transition-colors sm:min-h-[56px]"
          >
            <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{tNav("buyCredits")}</span>
          </Link>
          <Link
            href="/login"
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-center text-sm font-medium hover:bg-white/[0.05] transition-colors sm:min-h-[56px]"
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Link href="/my-purchases" className={actionCardClass}>
          <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {tNav("myPurchases")}
        </Link>

        <Link href="/favorites" className={actionCardClass}>
          <Heart className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {tNav("favorites")}
        </Link>

        <Link href="/referral" className={actionCardClass}>
          <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {tNav("referral")}
        </Link>

        <Link
          href="/custom-orders"
          className={actionCardClass}
        >
          <ShoppingCart className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {tNav("customOrders")}
        </Link>

        <Link
          href="/games/coinflip"
          className={actionCardClass}
        >
          <Gamepad2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {tNav("coinflip")}
        </Link>

        <Link href="/purchase" className={actionCardClass}>
          <Coins className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {tNav("buyCredits")}
        </Link>
      </div>
    </section>
  );
}
