"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  Coins,
  User,
  LogOut,
  LayoutDashboard,
  ShieldCheck,
  Heart,
  Menu,
  X,
  ChevronDown,
  ShoppingCart,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { formatCredits } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { trackLogout } from "@/lib/growth-analytics";

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

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

  const adminHomeHref = "/admin/content-insights/engagement";
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

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-background/95 pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex h-16 w-full min-w-0 max-w-7xl items-center justify-between pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]">
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
        <nav className="hidden md:flex items-center gap-1 ml-8">
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
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 relative">
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

          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Auth Buttons / User Menu */}
          {loading ? (
            <div className="h-9 w-20 animate-pulse rounded-xl bg-white/[0.05]" />
          ) : user ? (
              <div className="relative hidden md:block" ref={userMenuRef}>
                <button
                  type="button"
                  data-tour="tour-account"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-label={t("nav.userMenu")}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  className={cn(
                    "flex min-h-9 min-w-0 items-center justify-start gap-2 rounded-xl px-2.5 py-1.5 transition-all cursor-pointer",
                    userMenuOpen ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
                  )}
                >
                  <div className="h-7 w-7 rounded-lg bg-primary/25 flex items-center justify-center border border-primary/25">
                    <User className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                      userMenuOpen && "rotate-180"
                    )}
                  />
                </button>

                <AnimatePresence>
                  {userMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.96 }}
                      transition={{ type: "spring", damping: 25, stiffness: 400 }}
                      className="absolute right-0 mt-2 w-60 rounded-xl border border-white/[0.08] bg-card shadow-2xl shadow-black/40 py-1 overflow-hidden"
                    >
                    <div className="px-4 py-3 border-b border-white/[0.06]">
                      <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <Coins className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs text-muted-foreground">{formatCredits(user.creditBalance)} {t("common.credits")}</span>
                      </div>
                    </div>

                    <div className="py-1">
                      {[
                        { href: "/dashboard", icon: LayoutDashboard, label: t("nav.dashboard") },
                        { href: "/my-purchases", icon: ShoppingCart, label: t("nav.myPurchases") },
                        { href: "/favorites", icon: Heart, label: t("nav.favorites") },
                        { href: "/referral", icon: UserPlus, label: t("nav.referral") },
                        ...(isAdmin ? [{ href: adminHomeHref, icon: ShieldCheck, label: t("nav.admin") }] : []),
                      ].map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
                          onClick={() => setUserMenuOpen(false)}
                        >
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </Link>
                      ))}
                    </div>

                    <div className="border-t border-white/[0.06] py-1">
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-white/[0.04] transition-colors cursor-pointer"
                      >
                        <LogOut className="h-4 w-4" />
                        {t("nav.logout")}
                      </button>
                    </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
          ) : (
            <div className="flex items-center gap-2" data-tour="tour-guest-auth">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="min-h-[44px] md:min-h-9">
                  {t("nav.login")}
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="min-h-[44px] md:min-h-9">
                  {t("nav.register")}
                </Button>
              </Link>
            </div>
          )}

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="md:hidden cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-white/[0.05] transition-colors"
            onClick={() => {
              setUserMenuOpen(false);
              setMobileMenuOpen(!mobileMenuOpen);
            }}
            aria-label={mobileMenuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={mobileMenuOpen}
            data-tour={user ? "tour-account" : undefined}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation - grid-template-rows avoids layout thrashing from height animation */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ gridTemplateRows: "0fr", opacity: 0 }}
            animate={{ gridTemplateRows: "1fr", opacity: 1 }}
            exit={{ gridTemplateRows: "0fr", opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="grid md:hidden border-t border-white/[0.06] bg-background"
          >
            <nav className="flex flex-col gap-0.5 overflow-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] min-h-0">
              {navLinks.map((link) => {
                const navActive =
                  link.href === adminHomeHref ? isAdminNavActive : pathname === link.href;
                return (
                <Link
                  key={link.href}
                  href={link.href}
                  data-tour={
                    link.href === "/purchase"
                      ? user
                        ? "tour-buy-mobile"
                        : "tour-guest-credits"
                      : undefined
                  }
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    navActive
                      ? "bg-white/[0.06] text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
                );
              })}
              {user && (
                <>
                  <Link
                    href="/my-purchases"
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/[0.04] hover:text-foreground transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <ShoppingCart className="h-4 w-4 shrink-0" />
                    {t("nav.myPurchases")}
                  </Link>
                  <Link
                    href="/favorites"
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/[0.04] hover:text-foreground transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Heart className="h-4 w-4 shrink-0" />
                    {t("nav.favorites")}
                  </Link>
                  <Link
                    href="/referral"
                    className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/[0.04] hover:text-foreground transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <UserPlus className="h-4 w-4 shrink-0" />
                    {t("nav.referral")}
                  </Link>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 px-4 py-3 rounded-xl text-left text-sm font-medium text-destructive hover:bg-white/[0.04] transition-colors touch-manipulation"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleLogout();
                    }}
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    {t("nav.logout")}
                  </button>
                </>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
