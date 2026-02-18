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
    <aside className="w-64 border-r border-border bg-card p-4 hidden lg:block">
      <nav className="space-y-1">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
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
