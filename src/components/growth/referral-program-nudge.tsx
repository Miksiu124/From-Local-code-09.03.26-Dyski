"use client";

import { useEffect, useState } from "react";

const SESSION_SHOWN_KEY = "gf_referral_periodic_nudge_shown";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { X, UserPlus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trackReferralProgramNudge } from "@/lib/growth-analytics";
import {
  dismissPeriodicNudge,
  shouldShowPeriodicNudge,
} from "@/lib/referral-nudge-storage";
import { SESSION_BANNER_SUPPRESS_KEY } from "@/lib/referral-modal-storage";

/** Delay before the periodic banner may appear so the referral promo modal can show first. */
const BANNER_DELAY_MS = 2800;

type Me = {
  id?: string;
  role?: string;
  approvedCreditPurchasesCount?: number;
};

const HIDE_PATH_PREFIXES = [
  "/referral",
  "/login",
  "/register",
  "/purchase",
  "/admin",
];

function pathHidesNudge(pathname: string | null): boolean {
  if (!pathname) return true;
  return HIDE_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Occasional reminder for logged-in users who have completed at least one credit purchase.
 * Cooldown after dismiss (see referral-nudge-storage). Not shown on referral/login/purchase/admin routes.
 */
export function ReferralProgramNudge() {
  const pathname = usePathname();
  const t = useTranslations("referral");
  const [visible, setVisible] = useState(false);
  const [bannerAllowed, setBannerAllowed] = useState(false);

  useEffect(() => {
    const tmr = window.setTimeout(() => setBannerAllowed(true), BANNER_DELAY_MS);
    return () => window.clearTimeout(tmr);
  }, []);

  useEffect(() => {
    if (!bannerAllowed) {
      setVisible(false);
      return;
    }
    if (pathHidesNudge(pathname)) {
      setVisible(false);
      return;
    }
    if (!shouldShowPeriodicNudge()) {
      setVisible(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        if (
          typeof sessionStorage !== "undefined" &&
          sessionStorage.getItem(SESSION_BANNER_SUPPRESS_KEY) === "1"
        ) {
          setVisible(false);
          return;
        }
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (!res.ok || cancelled) {
          setVisible(false);
          return;
        }
        const data = (await res.json()) as Me;
        if (!data.id || data.role === "ADMIN") {
          setVisible(false);
          return;
        }
        const count = data.approvedCreditPurchasesCount ?? 0;
        if (count < 1) {
          setVisible(false);
          return;
        }
        setVisible(true);
      } catch {
        if (!cancelled) setVisible(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, bannerAllowed]);

  useEffect(() => {
    if (!visible) return;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(SESSION_SHOWN_KEY)) return;
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_SHOWN_KEY, "1");
    } catch {
      // ignore
    }
    trackReferralProgramNudge("periodic_banner", "shown");
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="border-b border-border bg-muted/40">
      <div className="container mx-auto flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <UserPlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-snug">{t("nudgePeriodicTitle")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{t("nudgePeriodicDesc")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:justify-end">
          <Link
            href="/referral"
            className={cn(buttonVariants({ size: "sm" }), "h-9")}
            onClick={() => trackReferralProgramNudge("periodic_banner", "cta_click")}
          >
            {t("nudgeOpenProgram")}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label={t("nudgeDismiss")}
            onClick={() => {
              dismissPeriodicNudge();
              trackReferralProgramNudge("periodic_banner", "dismissed");
              setVisible(false);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
