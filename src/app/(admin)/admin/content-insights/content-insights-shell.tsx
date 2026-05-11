"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, LayoutGroup, useReducedMotion } from "framer-motion";
import { Gauge, Sparkles, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/content-insights/engagement" as const, labelKey: "dashboardTabEngagement" as const, icon: Sparkles },
  { href: "/admin/content-insights/catalog" as const, labelKey: "dashboardTabCatalog" as const, icon: LayoutGrid },
];

export function ContentInsightsShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("admin");
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <div className="space-y-8 max-w-6xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Gauge className="h-8 w-8 text-primary" />
          {t("dashboardHomeTitle")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">{t("contentInsightsShellSubtitle")}</p>
        <p className="text-sm text-muted-foreground max-w-2xl">
          <Link href="/admin/analytics" className="text-primary font-medium hover:underline">
            {t("contentInsightsAnalyticsCtaLink")}
          </Link>{" "}
          {t("contentInsightsAnalyticsCtaTail")}
        </p>
      </header>

      <LayoutGroup>
        <div
          className={cn(
            "inline-flex rounded-2xl p-1 gap-0.5 border border-white/[0.08]",
            "bg-gradient-to-b from-white/[0.06] to-transparent",
            "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
          )}
          role="tablist"
          aria-label={t("contentInsightsTablistAria")}
        >
          {TABS.map(({ href, labelKey, icon: Icon }) => {
            const isOn = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                role="tab"
                aria-selected={isOn}
                className={cn(
                  "relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                  isOn ? "text-foreground" : "text-muted-foreground hover:text-foreground/90",
                )}
                scroll={false}
              >
                {isOn && !reduceMotion && (
                  <motion.span
                    layoutId="content-insights-tab"
                    className="absolute inset-0 rounded-xl bg-primary/15 border border-primary/25 shadow-[0_0_24px_-8px_rgba(139,92,246,0.5)]"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                {isOn && reduceMotion && (
                  <span className="absolute inset-0 rounded-xl bg-primary/15 border border-primary/25" />
                )}
                <Icon className="h-4 w-4 relative z-10 shrink-0" />
                <span className="relative z-10">{t(labelKey)}</span>
              </Link>
            );
          })}
        </div>
      </LayoutGroup>

      <div className="min-h-[12rem]">{children}</div>
    </div>
  );
}
