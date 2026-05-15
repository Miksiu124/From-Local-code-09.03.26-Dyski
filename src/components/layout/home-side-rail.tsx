"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  Coins,
  Heart,
  LayoutDashboard,
  List,
  LogOut,
  Menu,
  ShoppingCart,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

type HomeSideRailProps = {
  isAdmin: boolean;
};

export function HomeSideRail({ isAdmin }: HomeSideRailProps) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");
  const [expanded, setExpanded] = useState(true);

  const links = useMemo(
    () =>
      [
        { href: "/", label: t("models"), icon: LayoutDashboard },
        { href: "/my-purchases", label: t("myPurchases"), icon: ShoppingCart },
        { href: "/favorites", label: t("favorites"), icon: Heart },
        { href: "/custom-orders", label: t("customOrders"), icon: List },
        { href: "/referral", label: t("referral"), icon: UserPlus },
        { href: "/purchase", label: t("buyCredits"), icon: Coins },
        ...(isAdmin ? [{ href: "/admin/payments", label: t("admin"), icon: ShieldCheck }] : []),
      ] as const,
    [isAdmin, t],
  );

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <aside
      className={cn(
        "hidden md:sticky md:top-[5.5rem] md:flex md:h-[calc(100vh-7rem)] md:flex-col md:overflow-hidden rounded-xl border border-white/[0.09] bg-card transition-all duration-200",
        expanded ? "md:w-[200px]" : "md:w-[52px]",
      )}
      aria-label="Main side navigation"
    >
      <div className="p-2">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className={cn(
            "flex min-h-[40px] w-full items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground",
            expanded ? "justify-start gap-2 px-3" : "justify-center"
          )}
          title={expanded ? "Collapse menu" : "Expand menu"}
        >
          <Menu className="h-4 w-4 shrink-0" />
          {expanded && <span className="truncate text-sm font-semibold text-foreground/80">Navigation</span>}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="space-y-1">
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex min-h-[42px] w-full items-center rounded-lg border px-3 text-sm font-medium transition-colors",
                  active
                    ? "border-white/[0.12] bg-white/[0.08] text-foreground"
                    : "border-transparent text-muted-foreground hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-foreground",
                  !expanded && "justify-center px-2",
                )}
                title={!expanded ? link.label : undefined}
              >
                <link.icon className="h-4 w-4 shrink-0" />
                {expanded && <span className="ml-2.5 truncate">{link.label}</span>}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-white/[0.06] p-2">
        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            "flex min-h-[42px] w-full items-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive transition-colors hover:bg-destructive/15",
            expanded ? "justify-start gap-2.5 px-3 text-sm font-medium" : "justify-center px-2",
          )}
          title={!expanded ? t("logout") : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {expanded && <span>{t("logout")}</span>}
        </button>
      </div>
    </aside>
  );
}
