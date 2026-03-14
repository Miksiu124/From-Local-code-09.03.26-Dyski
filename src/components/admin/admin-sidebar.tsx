"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CreditCard,
  FolderOpen,
  Users,
  BarChart3,
  Settings,
  Coins,
  Tag,
  Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminSidebar() {
  const pathname = usePathname();
  const t = useTranslations("admin");

  const links = [
    { href: "/admin/payments", label: t("creditPurchases"), icon: CreditCard },
    { href: "/admin/packages", label: t("creditPackages"), icon: Coins },
    { href: "/admin/promo-codes", label: t("promoCodes"), icon: Tag },
    { href: "/admin/custom-links", label: t("customLinks"), icon: LinkIcon },
    { href: "/admin/models", label: t("models"), icon: FolderOpen },
    { href: "/admin/users", label: t("users"), icon: Users },
    { href: "/admin/analytics", label: t("analytics"), icon: BarChart3 },
    { href: "/admin/settings", label: t("settings"), icon: Settings },
  ];

  return (
    <>
      {/* ── Desktop sidebar (lg+) ─────────────────────────────────── */}
      <aside className="w-60 border-r border-white/[0.06] bg-card/50 p-3 hidden lg:block shrink-0">
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
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
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
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;

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
