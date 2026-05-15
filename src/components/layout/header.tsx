"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Coins,
  User,
  LogOut,
  Heart,
  ShoppingCart,
  UserPlus,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { formatCredits } from "@/lib/utils";
import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { trackLogout } from "@/lib/growth-analytics";

/** Stały link zaproszenia na serwer Discord (NEXT_PUBLIC_* — wymaga przebudowy frontu po zmianie). */
const DISCORD_SERVER_URL = (process.env.NEXT_PUBLIC_DISCORD_SERVER_URL ?? "").trim();

function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

interface UserSession {
  id: string;
  name: string;
  email: string;
  role: string;
  creditBalance: number;
}

export function Header() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();

    const handleAuthChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setUser(detail);
        setLoading(false);
      } else {
        fetchUser();
      }
    };
    window.addEventListener("auth-change", handleAuthChange);
    return () => window.removeEventListener("auth-change", handleAuthChange);
  }, []);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/user/balance");
        if (res.ok) {
          const data = await res.json();
          setUser((prev) => (prev ? { ...prev, creditBalance: data.creditBalance } : null));
        }
      } catch {
        // Silent fail
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const handleLogout = async () => {
    try {
      trackLogout({ role: user?.role === "ADMIN" ? "admin" : "user" });
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.push("/");
      router.refresh();
    } catch { }
  };

  const isAdmin = user?.role === "ADMIN";

  const adminHomeHref = "/admin/payments";
  const isAdminNavActive = pathname?.startsWith("/admin") ?? false;

  const handleLogoClick = (e: React.MouseEvent) => {
    // Reset models search state so logo returns to clean main page
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("models_search");
      sessionStorage.removeItem("models_country");
      sessionStorage.removeItem("models_purchased_only");
      sessionStorage.removeItem("models_scroll_y");
    }
    if (pathname === "/") {
      e.preventDefault();
      window.location.href = "/";
    }
  };

  const navLinks = [
    { href: "/", label: t("nav.models"), show: true },
    { href: "/purchase", label: t("nav.buyCredits"), show: true },
    { href: "/dashboard", label: t("nav.dashboard"), show: !!user },
    { href: adminHomeHref, label: t("nav.admin"), show: isAdmin },
  ].filter((l) => l.show);

  const quickUserLinks = [
    { href: "/my-purchases", label: t("nav.myPurchases") },
    { href: "/favorites", label: t("nav.favorites") },
    { href: "/referral", label: t("nav.referral") },
  ];
  const mobilePrimaryLinks = [
    { href: "/", label: t("nav.models"), show: true },
    { href: "/purchase", label: t("nav.buyCredits"), show: true },
    { href: "/dashboard", label: t("nav.dashboard"), show: !!user },
    { href: adminHomeHref, label: t("nav.admin"), show: isAdmin },
  ].filter((l) => l.show);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-background/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full min-w-0 max-w-7xl items-center justify-between pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] sm:h-16 sm:pl-[max(1rem,env(safe-area-inset-left,0px))] sm:pr-[max(1rem,env(safe-area-inset-right,0px))]">
        {/* Logo — resets search and returns to main page */}
        <Link
          href="/"
          className="group flex shrink-0 min-w-0 items-center rounded-lg py-1 outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={handleLogoClick}
          data-tour="tour-models-mobile"
        >
          <span className="font-heading text-[1.2rem] font-bold leading-none tracking-[0.03em] text-foreground md:text-[1.35rem]">
            Dyskiof
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="ml-8 hidden items-center gap-1 lg:flex">
          {navLinks.map((link) => {
            const navActive =
              link.href === adminHomeHref ? isAdminNavActive : pathname === link.href;
            return (
            <Link
              key={link.href}
              href={link.href}
              data-tour={
                link.href === "/"
                  ? "tour-models"
                  : link.href === "/purchase"
                    ? user
                      ? "tour-buy"
                      : "tour-guest-credits"
                    : undefined
              }
              className={cn(
                "px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                navActive
                  ? "text-foreground bg-white/[0.06]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              )}
            >
              {link.label}
            </Link>
            );
          })}
          {user && (
            <div className="ml-2 hidden items-center gap-1 xl:flex">
              {quickUserLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    pathname === link.href
                      ? "text-foreground bg-white/[0.06]"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </nav>

        {/* Right side */}
        <div className="relative flex items-center gap-1.5 sm:gap-2">
          {/* Credit Balance */}
          {user && (
            <>
              <Link href="/purchase" className="hidden sm:flex" data-tour="tour-credits">
                <div className="flex items-center gap-1.5 rounded-xl bg-white/[0.05] border border-white/[0.06] px-3 py-1.5 text-sm font-medium hover:bg-white/[0.08] transition-colors">
                  <Coins className="h-3.5 w-3.5 text-primary" />
                  <span className="text-foreground/90">{formatCredits(user.creditBalance)}</span>
                </div>
              </Link>
              <Link
                href="/purchase"
                className="flex sm:hidden min-h-[44px] max-w-[min(100%,9.5rem)] shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.05] px-2.5 py-1.5 text-primary hover:bg-white/[0.08] transition-colors touch-manipulation"
                aria-label={t("nav.buyCredits")}
                data-tour="tour-credits-mobile"
              >
                <Coins className="h-4 w-4 shrink-0" />
                <span className="text-xs font-medium tabular-nums text-foreground/90 truncate">
                  {formatCredits(user.creditBalance)}
                </span>
              </Link>
            </>
          )}

          {DISCORD_SERVER_URL ? (
            <a
              href={DISCORD_SERVER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.05]",
                "min-h-[44px] min-w-[44px] text-[#5865F2] hover:bg-white/[0.08] active:bg-white/[0.06]",
                "transition-colors touch-manipulation sm:min-h-9 sm:min-w-9",
              )}
              title={t("nav.discordServer")}
              aria-label={t("nav.discordServer")}
            >
              <DiscordGlyph className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
            </a>
          ) : null}

          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Auth Buttons / User Menu */}
          {loading ? (
            <div className="h-9 w-20 animate-pulse rounded-xl bg-white/[0.05]" />
          ) : user ? (
            <div className="hidden items-center gap-1 lg:flex">
              <Link
                href="/dashboard"
                data-tour="tour-account"
                aria-label={t("nav.dashboard")}
                className={cn(
                  "flex min-h-9 min-w-[44px] items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.05] px-2.5 py-1.5 transition-colors",
                  pathname === "/dashboard" ? "text-foreground bg-white/[0.08]" : "hover:bg-white/[0.08] text-muted-foreground"
                )}
              >
                <User className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-9 min-w-[44px] items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.05] px-2.5 py-1.5 text-destructive transition-colors hover:bg-white/[0.08] cursor-pointer"
                aria-label={t("nav.logout")}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center" data-tour="tour-guest-auth">
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ size: "sm", variant: "default" }),
                  "min-h-[44px] md:min-h-9 touch-manipulation"
                )}
              >
                {t("auth.loginTitle")}
              </Link>
            </div>
          )}

        </div>
      </div>
      <div className="border-t border-white/[0.06] px-[max(0.75rem,env(safe-area-inset-left,0px))] py-2 pr-[max(0.75rem,env(safe-area-inset-right,0px))] lg:hidden">
        <nav className="flex items-center gap-2 overflow-x-auto pb-1">
          {mobilePrimaryLinks.map((link) => {
            const navActive =
              link.href === adminHomeHref ? isAdminNavActive : pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                  navActive
                    ? "border-white/[0.14] bg-white/[0.08] text-foreground"
                    : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            );
          })}
          {DISCORD_SERVER_URL ? (
            <a
              href={DISCORD_SERVER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] p-2 text-[#5865F2] hover:bg-white/[0.05]"
              aria-label={t("nav.discordServer")}
              title={t("nav.discordServer")}
            >
              <DiscordGlyph className="h-4 w-4" />
            </a>
          ) : null}
        </nav>
        {user ? (
          <nav className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
            <Link
              href="/my-purchases"
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium transition-colors",
                pathname === "/my-purchases"
                  ? "text-foreground bg-white/[0.08] border-white/[0.14]"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
              )}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {t("nav.myPurchases")}
            </Link>
            <Link
              href="/favorites"
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium transition-colors",
                pathname === "/favorites"
                  ? "text-foreground bg-white/[0.08] border-white/[0.14]"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
              )}
            >
              <Heart className="h-3.5 w-3.5" />
              {t("nav.favorites")}
            </Link>
            <Link
              href="/referral"
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium transition-colors",
                pathname === "/referral"
                  ? "text-foreground bg-white/[0.08] border-white/[0.14]"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
              )}
            >
              <UserPlus className="h-3.5 w-3.5" />
              {t("nav.referral")}
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-white/[0.05]"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("nav.logout")}
            </button>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
