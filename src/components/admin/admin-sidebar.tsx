"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Activity,
  CreditCard,
  FolderOpen,
  Users,
  BarChart3,
  LineChart,
  Settings,
  Coins,
  Tag,
  Link as LinkIcon,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminSidebar() {
  const pathname = usePathname();
  const t = useTranslations("admin");

  const contentInsightsHref = "/admin/content-insights/engagement";
  const isContentInsightsActive = pathname.startsWith("/admin/content-insights");

  const links = [
    { href: "/admin/payments", label: t("creditPurchases"), icon: CreditCard },
    { href: "/admin/packages", label: t("creditPackages"), icon: Coins },
    { href: "/admin/promo-codes", label: t("promoCodes"), icon: Tag },
    { href: "/admin/custom-links", label: t("customLinks"), icon: LinkIcon },
    { href: "/admin/models", label: t("models"), icon: FolderOpen },
    { href: "/admin/users", label: t("users"), icon: Users },
    { href: "/admin/analytics", label: t("analytics"), icon: BarChart3 },
    { href: "/admin/funnel", label: t("funnelEventsNav"), icon: LineChart },
    { href: "/admin/observability", label: t("observability"), icon: Activity },
    { href: "/admin/settings", label: t("settings"), icon: Settings },
  ];

  const mobileLinks = [
    { href: contentInsightsHref, label: t("contentInsightsNavSingle"), icon: Sparkles },
    ...links,
  ];

  return (
    <>
      {/* ── Desktop sidebar (lg+) ─────────────────────────────────── */}
      <aside className="w-60 border-r border-white/[0.06] bg-card/50 p-3 hidden lg:block shrink-0">
        <div
          className={cn(
            "rounded-2xl border border-white/[0.08] p-2 mb-3",
            "bg-gradient-to-b from-primary/[0.09] via-primary/[0.04] to-transparent",
            "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
          )}
        >
          <Link
            href={contentInsightsHref}
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-all",
              isContentInsightsActive
                ? "bg-primary/15 text-primary font-medium shadow-[0_0_20px_-10px_rgba(139,92,246,0.6)]"
                : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]",
            )}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            {t("contentInsightsNavSingle")}
          </Link>
        </div>

        <nav className="space-y-0.5">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-all",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ── Mobile bottom nav bar (below lg) ─────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] flex lg:hidden border-t border-white/[0.06] bg-card/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom,0px)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {mobileLinks.map((link) => {
          const Icon = link.icon;
          const isActive =
            link.href === contentInsightsHref
              ? isContentInsightsActive
              : pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 px-0.5 sm:px-1 text-[10px] transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary")} />
              <span className="truncate w-full text-center leading-none">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Spacer so content isn't hidden behind the bottom nav on mobile */}
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </>
  );
}
