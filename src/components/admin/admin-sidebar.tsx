"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  CreditCard,
  FolderOpen,
  Users,
  BarChart3,
  Settings,
  Coins,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function AdminSidebar() {
  const pathname = usePathname();
  const t = useTranslations("admin");

  const links = [
    { href: "/admin", label: t("dashboard"), icon: LayoutDashboard },
    { href: "/admin/payments", label: t("creditPurchases"), icon: CreditCard },
    { href: "/admin/packages", label: t("creditPackages"), icon: Coins },
    { href: "/admin/models", label: t("models"), icon: FolderOpen },
    { href: "/admin/users", label: t("users"), icon: Users },
    { href: "/admin/analytics", label: t("analytics"), icon: BarChart3 },
    { href: "/admin/settings", label: t("settings"), icon: Settings },
  ];

  return (
    <aside className="w-60 border-r border-white/[0.06] bg-card/50 p-3 hidden lg:block">
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
              <Icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
