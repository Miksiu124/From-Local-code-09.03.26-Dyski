"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import {
  Coins,
  User,
  LogOut,
  LayoutDashboard,
  ShieldCheck,
  Bell,
  Heart,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { formatCredits } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Fetch user session on mount
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
  }, []);

  // Poll the real DB balance every 15 seconds
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

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.push("/");
      router.refresh();
      // Optional: window.location.reload(); 
    } catch { }
  };

  const isAdmin = user?.role === "ADMIN";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="text-xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent"
          >
            {t("common.appName")}
          </motion.div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Link
            href="/models"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("nav.models")}
          </Link>
          {user && (
            <Link
              href="/purchase"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("nav.buyCredits")}
            </Link>
          )}
          {user && (
            <Link
              href="/dashboard"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("nav.dashboard")}
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("nav.admin")}
            </Link>
          )}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Credit Balance */}
          {user && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="hidden sm:flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-sm font-medium"
            >
              <Coins className="h-4 w-4 text-primary" />
              <span>{formatCredits(user.creditBalance)}</span>
            </motion.div>
          )}

          {/* Notifications */}
          {user && (
            <Link href="/dashboard?tab=notifications">
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
              </Button>
            </Link>
          )}

          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Auth Buttons / User Menu */}
          {loading ? (
            <div className="h-10 w-20 animate-pulse rounded-lg bg-muted" />
          ) : user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-secondary transition-colors cursor-pointer"
              >
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>

              {userMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-card shadow-xl py-1"
                >
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-sm font-medium">{user.name || user.email}</p>
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <Coins className="h-3 w-3 text-primary" />
                      {formatCredits(user.creditBalance)} {t("common.credits")}
                    </div>
                  </div>

                  <Link
                    href="/dashboard"
                    className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-secondary transition-colors"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    {t("nav.dashboard")}
                  </Link>

                  <Link
                    href="/my-purchases"
                    className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-secondary transition-colors"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Coins className="h-4 w-4" />
                    {t("nav.myPurchases")}
                  </Link>

                  <Link
                    href="/favorites"
                    className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-secondary transition-colors"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <Heart className="h-4 w-4" />
                    {t("nav.favorites")}
                  </Link>

                  {isAdmin && (
                    <Link
                      href="/admin"
                      className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-secondary transition-colors"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {t("nav.admin")}
                    </Link>
                  )}

                  <div className="border-t border-border mt-1 pt-1">
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-secondary transition-colors cursor-pointer"
                    >
                      <LogOut className="h-4 w-4" />
                      {t("nav.logout")}
                    </button>
                  </div>
                </motion.div>
              )}
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
            className="md:hidden cursor-pointer"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="md:hidden border-t border-border bg-background"
        >
          <nav className="flex flex-col p-4 gap-2">
            <Link
              href="/models"
              className="px-4 py-2 rounded-lg hover:bg-secondary transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              {t("nav.models")}
            </Link>
            {user && (
              <>
                <Link
                  href="/purchase"
                  className="px-4 py-2 rounded-lg hover:bg-secondary transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t("nav.buyCredits")}
                </Link>
                <Link
                  href="/dashboard"
                  className="px-4 py-2 rounded-lg hover:bg-secondary transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {t("nav.dashboard")}
                </Link>
                <div className="flex items-center gap-2 px-4 py-2">
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
    </header>
  );
}
