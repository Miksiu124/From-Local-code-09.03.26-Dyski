"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Bell,
  Cloud,
  CircleHelp,
  Coins,
  Heart,
  House,
  User,
  Menu,
  LogOut,
  Package,
  ShoppingCart,
  UserPlus,
  X,
  ShieldCheck,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { formatCredits } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { trackLogout } from "@/lib/growth-analytics";

/** Stały link zaproszenia na serwer Discord (NEXT_PUBLIC_* — wymaga przebudowy frontu po zmianie). */
const DISCORD_SERVER_URL = (process.env.NEXT_PUBLIC_DISCORD_SERVER_URL ?? "").trim();

function drawerIconColor(href: string): string {
  if (href === "/") return "text-primary";
  if (href === "/favorites") return "text-rose-400";
  if (href === "/purchase") return "text-amber-400";
  if (href === "/my-purchases") return "text-amber-400";
  if (href === "/custom-orders") return "text-orange-400";
  if (href === "/referral") return "text-emerald-400";
  if (href === "/dashboard") return "text-sky-400";
  if (href.startsWith("/admin")) return "text-violet-400";
  return "text-muted-foreground";
}

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

interface UserNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export function Header() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const [expandedNotifIds, setExpandedNotifIds] = useState<Set<string>>(new Set());
  const notificationsRef = useRef<HTMLDivElement>(null);

  const NOTIF_VISIBLE_COUNT = 10;

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
    if (!user) return;
    let cancelled = false;
    const loadUnread = async () => {
      try {
        const [countRes, listRes] = await Promise.all([
          fetch("/api/notifications/unread-count", { credentials: "include" }),
          fetch("/api/notifications?unread=1&limit=20", { credentials: "include" }),
        ]);
        if (!cancelled && countRes.ok) {
          const countData = await countRes.json();
          setUnreadCount(Number(countData?.unreadCount ?? 0));
        }
        if (!cancelled && listRes.ok) {
          const listData = await listRes.json();
          setNotifications(Array.isArray(listData) ? listData : []);
        }
      } catch {
        if (!cancelled) {
          setUnreadCount(0);
          setNotifications([]);
        }
      }
    };
    loadUnread();
    const interval = setInterval(loadUnread, 45000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const es = new EventSource("/api/notifications/stream", { withCredentials: true });
    es.onmessage = () => {
      fetch("/api/notifications/unread-count", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : { unreadCount: 0 }))
        .then((data) => setUnreadCount(Number(data?.unreadCount ?? 0)))
        .catch(() => null);
      fetch("/api/notifications?unread=1&limit=20", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => setNotifications(Array.isArray(data) ? data : []))
        .catch(() => null);
    };
    return () => es.close();
  }, [user]);

  useEffect(() => {
    const closeOnOutside = (event: MouseEvent) => {
      if (!notificationsRef.current) return;
      if (!notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
        setShowAllNotifications(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const openMobileMenuForTour = () => {
      setNotificationsOpen(false);
      setMobileMenuOpen(true);
    };
    window.addEventListener("tour:open-mobile-menu", openMobileMenuForTour);
    return () => window.removeEventListener("tour:open-mobile-menu", openMobileMenuForTour);
  }, []);

  const handleLogout = async () => {
    try {
      trackLogout({ role: user?.role === "ADMIN" ? "admin" : "user" });
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.push("/");
      router.refresh();
    } catch { }
  };

  const markNotificationAsRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await fetch(`/api/notifications/${id}`, { method: "PATCH", credentials: "include" });
    } catch {
      // optimistic update already applied
    }
  };

  const toggleNotifExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedNotifIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const markAllNotificationsAsRead = async () => {
    try {
      setNotificationsLoading(true);
      await fetch("/api/notifications", { method: "PATCH", credentials: "include" });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } finally {
      setNotificationsLoading(false);
    }
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

  const mobilePrimaryLinks = [
    { href: "/", label: t("nav.models"), show: true },
    { href: "/purchase", label: t("nav.buyCredits"), show: true },
    { href: "/dashboard", label: t("nav.dashboard"), show: !!user },
    { href: adminHomeHref, label: t("nav.admin"), show: isAdmin },
  ].filter((l) => l.show);
  const isOddMobilePrimaryCount = mobilePrimaryLinks.length % 2 === 1;
  const useSideRailNavigation = !!user;
  const mobileDrawerLinks = [
    { href: "/", label: t("nav.models"), icon: House, show: true },
    { href: "/dashboard", label: t("nav.dashboard"), icon: User, show: !!user },
    { href: "/my-purchases", label: t("nav.myPurchases"), icon: Package, show: !!user },
    { href: "/custom-orders", label: t("nav.customOrders"), icon: ShoppingCart, show: !!user },
    { href: "/favorites", label: t("nav.favorites"), icon: Heart, show: !!user },
    { href: "/purchase", label: t("nav.buyCredits"), icon: Coins, show: !!user },
    { href: "/referral", label: t("nav.referral"), icon: UserPlus, show: !!user },
    { href: adminHomeHref, label: t("nav.admin"), icon: ShieldCheck, show: isAdmin },
  ].filter((l) => l.show);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-background/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full min-w-0 max-w-7xl items-center justify-between pl-[max(0.75rem,env(safe-area-inset-left,0px))] pr-[max(0.75rem,env(safe-area-inset-right,0px))] sm:h-16 sm:pl-[max(1rem,env(safe-area-inset-left,0px))] sm:pr-[max(1rem,env(safe-area-inset-right,0px))]">
        <div className="mr-2 flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={() => {
              setNotificationsOpen(false);
              setMobileMenuOpen((prev) => !prev);
            }}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.05] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
            aria-label={mobileMenuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={mobileMenuOpen}
            data-tour="tour-menu-trigger"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
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
          {!useSideRailNavigation &&
            navLinks.map((link) => {
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

          {user && (
            <div className="relative" ref={notificationsRef}>
              <button
                type="button"
                onClick={() => {
                  setNotificationsOpen((prev) => {
                    if (prev) setShowAllNotifications(false);
                    return !prev;
                  });
                }}
                className="relative flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.05] transition-colors hover:bg-white/[0.08] sm:min-h-9 sm:min-w-9"
                aria-label={t("notifications.title")}
              >
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
              {notificationsOpen && (() => {
                const visibleNotifs = showAllNotifications
                  ? notifications
                  : notifications.slice(0, NOTIF_VISIBLE_COUNT);
                const hiddenCount = notifications.length - NOTIF_VISIBLE_COUNT;
                const hasUnread = notifications.some((n) => !n.isRead);
                return (
                  <div className="notif-panel-enter absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[min(92vw,380px)] rounded-xl border border-white/[0.08] bg-card shadow-2xl shadow-black/50">
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
                      <span className="text-sm font-semibold">{t("notifications.title")}</span>
                      <button
                        type="button"
                        onClick={markAllNotificationsAsRead}
                        disabled={notificationsLoading || !hasUnread}
                        className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        {t("notifications.markAllRead")}
                      </button>
                    </div>
                    <div className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
                      {notifications.length === 0 ? (
                        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-xs text-muted-foreground">
                          {t("notifications.noNotifications")}
                        </div>
                      ) : (
                        <>
                          {visibleNotifs.map((item, index) => (
                            <div
                              key={item.id}
                              style={{ "--notif-i": index } as React.CSSProperties}
                              onClick={() => !item.isRead && markNotificationAsRead(item.id)}
                              className={cn(
                                "notif-item-enter mb-1.5 rounded-lg border px-3 py-2.5 transition-all duration-300",
                                item.isRead
                                  ? "cursor-default border-white/[0.03] bg-transparent opacity-50"
                                  : "cursor-pointer border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.07] active:bg-white/[0.06]"
                              )}
                            >
                              <div className="flex items-start gap-2">
                                {!item.isRead && (
                                  <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className={cn(
                                    "text-sm leading-snug",
                                    item.isRead ? "font-medium text-muted-foreground" : "font-semibold"
                                  )}>
                                    {item.title}
                                  </p>
                                  <p className={cn(
                                    "mt-0.5 text-xs leading-relaxed text-muted-foreground",
                                    !expandedNotifIds.has(item.id) && "line-clamp-2"
                                  )}>
                                    {item.message}
                                  </p>
                                  {item.message.length > 110 && (
                                    <button
                                      type="button"
                                      onClick={(e) => toggleNotifExpand(item.id, e)}
                                      className="mt-1 text-[11px] font-medium text-primary/60 transition-colors hover:text-primary"
                                    >
                                      {expandedNotifIds.has(item.id) ? "zwiń ↑" : "rozwiń ↓"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                          {!showAllNotifications && hiddenCount > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowAllNotifications(true)}
                              style={{ "--notif-i": NOTIF_VISIBLE_COUNT } as React.CSSProperties}
                              className="notif-item-enter w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
                            >
                              + {hiddenCount} więcej
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Auth Buttons / User Menu */}
          {loading ? (
            <div className="h-9 w-20 animate-pulse rounded-xl bg-white/[0.05]" />
          ) : user ? (
            <>
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
              <button
                type="button"
                onClick={handleLogout}
                className="hidden min-h-9 min-w-[44px] items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.05] px-2.5 py-1.5 text-destructive transition-colors hover:bg-white/[0.08] md:flex lg:hidden"
                aria-label={t("nav.logout")}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
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
      <div className={cn(
        "border-t border-white/[0.06] px-[max(0.75rem,env(safe-area-inset-left,0px))] py-1.5 pr-[max(0.75rem,env(safe-area-inset-right,0px))]",
        useSideRailNavigation ? "md:hidden" : "lg:hidden"
      )}>
        <nav className="grid grid-cols-2 gap-1.5">
          {mobilePrimaryLinks.map((link, index) => {
            const navActive =
              link.href === adminHomeHref ? isAdminNavActive : pathname === link.href;
            const spanTwoCols = isOddMobilePrimaryCount && index === mobilePrimaryLinks.length - 1;
            return (
              <Link
                key={link.href}
                href={link.href}
                data-tour={
                  link.href === "/"
                    ? "tour-models-mobile"
                    : link.href === "/purchase"
                      ? "tour-guest-credits"
                      : undefined
                }
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-center text-[11px] font-medium transition-colors",
                  spanTwoCols && "col-span-2",
                  navActive
                    ? "border-white/[0.14] bg-white/[0.08] text-foreground"
                    : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/75"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[82vw] max-w-[310px] flex-col overflow-hidden px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-[calc(0.875rem+env(safe-area-inset-top,0px))] shadow-2xl shadow-black/80" style={{ background: '#0e1117' }}>
            {/* Header */}
            <div className="mb-5 flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Cloud className="h-4 w-4" />
                </span>
                <span className="text-[0.8rem] font-bold tracking-[0.12em] uppercase text-foreground/90">
                  Menu
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  window.dispatchEvent(new CustomEvent("tour:restart"));
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.04] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                aria-label="Help"
              >
                <CircleHelp className="h-4 w-4" />
              </button>
            </div>

            {/* User info */}
            {user && (
              <div className="mb-5 flex flex-col items-center gap-2.5">
                <span className="text-[0.85rem] font-bold tracking-[0.14em] uppercase text-foreground">
                  {user.name}
                </span>
                <Link
                  href="/purchase"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/15"
                >
                  <span className="text-[0.9em]">💎</span>
                  <span>{formatCredits(user.creditBalance)}</span>
                </Link>
              </div>
            )}

            {/* Nav */}
            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {mobileDrawerLinks.map((link) => {
                const navActive = link.href === adminHomeHref ? isAdminNavActive : pathname === link.href;
                const drawerTourId: string | undefined =
                  link.href === "/" ? "tour-models-mobile"
                  : link.href === "/purchase" ? (user ? "tour-buy-mobile" : "tour-guest-credits")
                  : link.href === "/dashboard" ? "tour-account"
                  : undefined;
                const iconColorClass = drawerIconColor(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    data-tour={drawerTourId}
                    className={cn(
                      "flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-3.5 text-sm font-medium transition-colors",
                      navActive
                        ? "border-white/[0.12] bg-white/[0.08] text-foreground"
                        : "border-transparent text-muted-foreground hover:border-white/[0.07] hover:bg-white/[0.05] hover:text-foreground"
                    )}
                  >
                    <link.icon className={cn("h-[18px] w-[18px] shrink-0", iconColorClass)} />
                    <span className="flex-1 truncate">{link.label}</span>
                    {navActive && (
                      <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                    )}
                  </Link>
                );
              })}
              {DISCORD_SERVER_URL && (
                <a
                  href={DISCORD_SERVER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-transparent px-3.5 text-sm font-medium text-[#5865F2] transition-colors hover:border-white/[0.07] hover:bg-white/[0.05]"
                >
                  <DiscordGlyph className="h-[18px] w-[18px] shrink-0" />
                  <span>{t("nav.discordServer")}</span>
                </a>
              )}
            </nav>

            {/* Bottom */}
            <div className="mt-4 shrink-0 space-y-2">
              {user ? (
                <>
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground"
                  >
                    <User className="h-[18px] w-[18px] shrink-0 text-primary" />
                    <span>{t("nav.dashboard")}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleLogout();
                    }}
                    className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 hover:border-destructive/30"
                  >
                    <LogOut className="h-[18px] w-[18px] shrink-0" />
                    <span>{t("nav.logout")}</span>
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80 touch-manipulation"
                >
                  <User className="h-4 w-4 shrink-0" />
                  <span>{t("auth.loginTitle")}</span>
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}
