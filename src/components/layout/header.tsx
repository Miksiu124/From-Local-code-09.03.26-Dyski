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
} from "lucide-react";
import { NotificationBell } from "@/components/layout/notification-bell";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { formatCredits } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

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
  const rightSideRef = useRef<HTMLDivElement>(null);

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
    }, 15000);
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
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.push("/");
      router.refresh();
    } catch { }
  };

  const isAdmin = user?.role === "ADMIN";

  const navLinks = [
    { href: "/", label: t("nav.models"), show: true },
    { href: "/purchase", label: t("nav.buyCredits"), show: !!user },
    { href: "/dashboard", label: t("nav.dashboard"), show: !!user },
    { href: "/admin", label: t("nav.admin"), show: isAdmin },
  ].filter((l) => l.show);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-xl font-bold bg-gradient-to-r from-primary via-purple-400 to-primary bg-clip-text text-transparent">
            {t("common.appName")}
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1 ml-8">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                pathname === link.href
                  ? "text-foreground bg-white/[0.06]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div ref={rightSideRef} className="flex items-center gap-2 relative">
          {/* Credit Balance */}
          {user && (
            <Link href="/purchase" className="hidden sm:flex">
              <div className="flex items-center gap-1.5 rounded-xl bg-white/[0.05] border border-white/[0.06] px-3 py-1.5 text-sm font-medium hover:bg-white/[0.08] transition-colors">
                <Coins className="h-3.5 w-3.5 text-primary" />
                <span className="text-foreground/90">{formatCredits(user.creditBalance)}</span>
              </div>
            </Link>
          )}

          {/* Notifications */}
          {user && <NotificationBell dropdownAnchorRef={rightSideRef} />}

          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Auth Buttons / User Menu */}
          {loading ? (
            <div className="h-9 w-20 animate-pulse rounded-xl bg-white/[0.05]" />
          ) : user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-all cursor-pointer",
                  userMenuOpen ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
                )}
              >
                <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-primary/30 to-purple-600/30 flex items-center justify-center border border-primary/20">
                  <User className="h-3.5 w-3.5 text-primary" />
                </div>
                <ChevronDown className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                  userMenuOpen && "rotate-180"
                )} />
              </button>

              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ type: "spring", damping: 25, stiffness: 400 }}
                    className="absolute right-0 mt-2 w-60 rounded-xl border border-white/[0.08] bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/40 py-1 overflow-hidden"
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
                        ...(isAdmin ? [{ href: "/admin", icon: ShieldCheck, label: t("nav.admin") }] : []),
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
            <div className="flex items-center gap-2">
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  {t("nav.login")}
                </Button>
              </Link>
              <Link href="/register">
                <Button size="sm">{t("nav.register")}</Button>
              </Link>
            </div>
          )}

          {/* Mobile menu toggle */}
          <button
            className="md:hidden cursor-pointer p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="md:hidden border-t border-white/[0.06] bg-background/95 backdrop-blur-xl overflow-hidden"
          >
            <nav className="flex flex-col p-3 gap-0.5">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-4 py-3 rounded-xl text-sm font-medium transition-colors",
                    pathname === link.href
                      ? "bg-white/[0.06] text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  )}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              {user && (
                <>
                  <Link
                    href="/favorites"
                    className="px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-white/[0.04] hover:text-foreground transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {t("nav.favorites")}
                  </Link>
                  <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.06] mt-1 pt-3">
                    <Coins className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      {formatCredits(user.creditBalance)} {t("common.credits")}
                    </span>
                  </div>
                </>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
