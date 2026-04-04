"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const FLAG_KEY = "dyskiof_show_post_auth_guide";

/**
 * One-time welcome dialog after login (session flag set on login page).
 */
export function PostAuthGuideAutostart() {
  const t = useTranslations("onboarding");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(FLAG_KEY) !== "1") return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok || cancelled) return;
        setOpen(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    sessionStorage.removeItem(FLAG_KEY);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && dismiss()}>
      <DialogHeader>
        <DialogTitle>{t("postAuthTitle")}</DialogTitle>
        <DialogDescription className="text-left leading-relaxed pt-1">
          {t("postAuthBody")}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" onClick={dismiss}>
          {t("postAuthGotIt")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
