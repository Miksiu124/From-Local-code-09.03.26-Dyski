"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, Check, Gift } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { trackReferralProgramNudge } from "@/lib/growth-analytics";
import { logger } from "@/lib/logger";
import {
  dismissReferralPromoModal,
  hasAutoShownModalThisSession,
  markModalAutoShownThisSession,
  shouldShowReferralPromoModal,
} from "@/lib/referral-modal-storage";

type Me = {
  id?: string;
  role?: string;
  approvedCreditPurchasesCount?: number;
};

type ReferralMe = {
  referralLink: string;
  bonuses?: {
    creditsReferrer: number;
    bonusPercentReferee: number;
  };
};

const HIDE_PATH_PREFIXES = [
  "/referral",
  "/login",
  "/register",
  "/purchase",
  "/admin",
];

const OPEN_DELAY_MS = 1600;

function pathHidesModal(pathname: string | null): boolean {
  if (!pathname) return true;
  return HIDE_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function ReferralProgramModal() {
  const pathname = usePathname();
  const t = useTranslations("referral");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ReferralMe | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackedShownRef = useRef(false);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (pathHidesModal(pathname)) {
      setOpen(false);
      setData(null);
    }
  }, [pathname]);

  useEffect(() => {
    if (pathHidesModal(pathname)) return;
    if (!shouldShowReferralPromoModal()) return;
    if (hasAutoShownModalThisSession()) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const meRes = await fetch("/api/auth/me", { credentials: "include" });
          if (!meRes.ok || cancelled) return;
          const me = (await meRes.json()) as Me;
          if (!me.id || me.role === "ADMIN") return;
          if ((me.approvedCreditPurchasesCount ?? 0) < 1) return;

          const refRes = await fetch("/api/referral/me", { credentials: "include" });
          if (!refRes.ok || cancelled) return;
          const json = (await refRes.json()) as ReferralMe;
          if (!json?.referralLink || cancelled) return;
          setData(json);
          setOpen(true);
          markModalAutoShownThisSession();
        } catch (e) {
          logger.error("ReferralProgramModal fetch failed", e);
        }
      })();
    }, OPEN_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!open || trackedShownRef.current) return;
    trackedShownRef.current = true;
    trackReferralProgramNudge("promo_modal", "shown");
  }, [open]);

  const handleDismiss = (reason: "later" | "overlay") => {
    dismissReferralPromoModal();
    setOpen(false);
    setData(null);
    trackReferralProgramNudge("promo_modal", "dismissed", { reason });
  };

  const handleCopy = async () => {
    if (!data?.referralLink) return;
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      trackReferralProgramNudge("promo_modal", "cta_click", { target: "copy" });
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch (e) {
      logger.error("Referral modal copy failed", e);
    }
  };

  const creditsReferrer = data?.bonuses?.creditsReferrer ?? 10;
  const bonusPercentReferee = data?.bonuses?.bonusPercentReferee ?? 20;

  if (!open || !data) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleDismiss("overlay");
        else setOpen(true);
      }}
      overlayClassName="bg-black/80 backdrop-blur-md"
    >
      <div className="pr-6 pt-1">
        <div className="flex flex-col gap-4 text-left">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15">
              <Gift className="h-5 w-5 text-violet-400" aria-hidden />
            </div>
            <DialogHeader className="space-y-2 text-left sm:text-left">
              <DialogTitle className="text-lg font-semibold leading-snug pr-2">
                {t("modalTitle")}
              </DialogTitle>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("modalBody", {
                  creditsReferrer,
                  bonusPercentReferee,
                })}
              </p>
            </DialogHeader>
          </div>

          {data?.referralLink && (
            <>
              <Input
                readOnly
                value={data.referralLink}
                className="border-white/[0.08] bg-secondary/80 font-mono text-xs sm:text-sm"
              />
              <Button
                type="button"
                className="w-full gap-2"
                variant="secondary"
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-green-500" aria-hidden />
                    {t("modalCopied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden />
                    {t("modalCopyLink")}
                  </>
                )}
              </Button>
            </>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => handleDismiss("later")}>
              {t("modalLater")}
            </Button>
            <Link
              href="/referral"
              className={cn(buttonVariants(), "inline-flex")}
              onClick={() => {
                trackReferralProgramNudge("promo_modal", "cta_click", { target: "referral_page" });
                dismissReferralPromoModal();
                setOpen(false);
                setData(null);
              }}
            >
              {t("modalReferralPage")}
            </Link>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
