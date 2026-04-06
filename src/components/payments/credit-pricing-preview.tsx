"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { Coins, LogIn, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn, formatPrice } from "@/lib/utils";
import { GROWTH } from "@/lib/growth-event-names";
import { emitGrowthEvent } from "@/lib/growth-events";

export type PricingPackage = {
  id: string;
  name: string;
  credits: number;
  price: number;
  tier: number;
};

export function CreditPricingPreview({ packages }: { packages: PricingPackage[] }) {
  const t = useTranslations("credits");
  const reduceMotion = useReducedMotion();
  const logged = useRef(false);

  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    emitGrowthEvent(GROWTH.PRICING_VIEWED, { surface: "credit_pricing_public" });
  }, []);

  return (
    <div className="grid w-full gap-8 lg:grid-cols-[minmax(272px,320px)_minmax(0,1fr)] lg:gap-10 xl:gap-12 items-start slide-up">
      <aside
        className={cn(
          "order-2 space-y-4 rounded-2xl border border-border/80 bg-muted/20 p-5 lg:order-1 lg:sticky lg:top-20 lg:self-start",
          "dark:border-white/[0.08] dark:bg-muted/10",
        )}
      >
        <header className="space-y-2 border-b border-border/60 pb-4">
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">{t("publicTitle")}</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("publicSubtitle")}</p>
        </header>
        <div className="flex flex-wrap gap-2">
          <Link href="/login" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
            <LogIn className="h-4 w-4" />
            {t("publicLoginCta")}
          </Link>
          <Link href="/register" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
            <UserPlus className="h-4 w-4" />
            {t("publicRegisterCta")}
          </Link>
        </div>
      </aside>

      <div className="order-1 min-w-0 lg:order-2">
        <h2 className="mb-4 text-lg font-semibold">{t("packages")}</h2>
        <div className="grid gap-3">
          {packages.map((pkg, index) => (
            <motion.div
              key={pkg.id}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.32, delay: index * 0.05, ease: [0.25, 0.1, 0.25, 1] }
              }
            >
              <Card className="border-white/[0.08] bg-card/40">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 sm:h-12 sm:w-12">
                      <Coins className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold sm:text-lg">{pkg.name}</p>
                      <p className="text-xs text-muted-foreground sm:text-sm">
                        {pkg.credits} {t("creditsLabel")} · {formatPrice(pkg.price / pkg.credits, undefined, { exact: true })}{" "}
                        {t("perCredit")}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 pl-2 text-right">
                    <p className="text-xl font-bold tabular-nums sm:text-2xl">{formatPrice(pkg.price)}</p>
                    <p className="text-xs text-primary sm:text-sm">
                      {pkg.credits} {t("creditsLabel")}
                    </p>
                    {pkg.tier >= 3 && (
                      <Badge variant="default" className="mt-1 text-[10px]">
                        {pkg.tier === 4 ? t("bestValue") : t("popular")}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {packages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("publicNoPackages")}</p>
        )}
      </div>
    </div>
  );
}
