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
    <div className="max-w-2xl mx-auto slide-up">
      <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-transparent to-purple-600/[0.06] p-5 sm:p-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{t("publicTitle")}</h1>
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{t("publicSubtitle")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/login" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
            <LogIn className="h-4 w-4" />
            {t("publicLoginCta")}
          </Link>
          <Link href="/register" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
            <UserPlus className="h-4 w-4" />
            {t("publicRegisterCta")}
          </Link>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-4">{t("packages")}</h2>
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
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                  <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                    <Coins className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-base sm:text-lg truncate">{pkg.name}</p>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {pkg.credits} {t("creditsLabel")} · {formatPrice(pkg.price / pkg.credits, undefined, { exact: true })}{" "}
                      {t("perCredit")}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0 pl-2">
                  <p className="text-xl sm:text-2xl font-bold tabular-nums">{formatPrice(pkg.price)}</p>
                  <p className="text-xs sm:text-sm text-primary">
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
        <p className="text-sm text-muted-foreground text-center py-8">{t("publicNoPackages")}</p>
      )}
    </div>
  );
}
