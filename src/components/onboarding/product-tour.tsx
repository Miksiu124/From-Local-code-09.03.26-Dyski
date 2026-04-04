"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEP_TARGETS_MEMBER = ["tour-models", "tour-credits", "tour-buy", "tour-account"] as const;
const STEP_TARGETS_GUEST = ["tour-models", "tour-guest-search", "tour-guest-filters", "tour-guest-auth"] as const;

export type ProductTourMode = "member" | "guest";

type Rect = { top: number; left: number; width: number; height: number };

const CARD_W_MAX_PX = 352; /* 22rem */
const CARD_EST_HEIGHT = 260;
const CARD_GAP = 12;

function measureTarget(id: string): Rect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(`[data-tour="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Places the tooltip card below the target, or above if there is not enough room (short viewports). */
function computeCardPosition(rect: Rect): { left: number; top: number } {
  if (typeof window === "undefined") return { left: 0, top: 0 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(vw * 0.92, CARD_W_MAX_PX);
  const half = cardW / 2;
  const centerX = rect.left + rect.width / 2;
  const left = Math.max(8 + half, Math.min(centerX, vw - 8 - half));
  let top = rect.top + rect.height + CARD_GAP;
  if (top + CARD_EST_HEIGHT > vh - 16) {
    top = rect.top - CARD_EST_HEIGHT - CARD_GAP;
  }
  top = Math.max(16, Math.min(top, vh - CARD_EST_HEIGHT - 16));
  return { left, top };
}

export function ProductTour({
  mode,
  open,
  step,
  onNext,
  onSkip,
  onClose,
}: {
  mode: ProductTourMode;
  open: boolean;
  step: number;
  onNext: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("onboarding");
  const reduceMotion = useReducedMotion();
  const transition = useMemo(
    () =>
      reduceMotion
        ? { duration: 0.2, ease: "easeOut" as const }
        : { type: "spring" as const, stiffness: 380, damping: 34, mass: 0.88 },
    [reduceMotion],
  );

  const [rect, setRect] = useState<Rect | null>(null);

  const targets = useMemo(
    () => (mode === "member" ? STEP_TARGETS_MEMBER : STEP_TARGETS_GUEST),
    [mode],
  );
  const stepCount = targets.length;

  const refresh = useCallback(() => {
    if (!open || step < 0 || step >= stepCount) {
      setRect(null);
      return;
    }
    setRect(measureTarget(targets[step]));
  }, [open, step, stepCount, targets]);

  useLayoutEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => refresh();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, refresh]);

  if (!open || typeof document === "undefined") return null;

  const isLast = step >= stepCount - 1;
  const titleKey =
    mode === "member"
      ? (`tourStep${step + 1}Title` as const)
      : (`guestTourStep${step + 1}Title` as const);
  const bodyKey =
    mode === "member"
      ? (`tourStep${step + 1}Body` as const)
      : (`guestTourStep${step + 1}Body` as const);

  const cardPos = rect ? computeCardPosition(rect) : null;

  const cardAnimate =
    cardPos != null
      ? { left: cardPos.left, top: cardPos.top, x: "-50%", y: 0, opacity: 1 }
      : { left: "50%", top: "50%", x: "-50%", y: "-50%", opacity: 1 };

  const overlay = (
    <>
      <motion.div
        className="fixed inset-0 z-[199] bg-black/55 backdrop-blur-[2px]"
        aria-hidden
        initial={false}
        animate={{ opacity: 1 }}
        transition={{ duration: reduceMotion ? 0.15 : 0.28, ease: "easeOut" }}
        onClick={onSkip}
      />
      {rect && (
        <motion.div
          className={cn(
            "fixed z-[200] rounded-xl pointer-events-none border-2 border-primary/80 tour-spotlight-pulse",
            "shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]",
          )}
          initial={false}
          animate={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
          transition={transition}
          style={{ willChange: reduceMotion ? undefined : "transform, width, height, top, left" }}
        />
      )}
      <motion.div
        className={cn(
          "fixed z-[200] w-[min(92vw,22rem)] rounded-2xl border border-white/[0.08] bg-card/95 backdrop-blur-xl shadow-2xl p-4 text-sm",
        )}
        initial={false}
        animate={cardAnimate}
        transition={transition}
        style={{ willChange: reduceMotion ? undefined : "transform, top, left" }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground tabular-nums">
            {t("tourStepProgress", { current: step + 1, total: stepCount })}
          </p>
          <button
            type="button"
            onClick={onSkip}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
            aria-label={t("tourSkip")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-3 h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary/90 origin-left"
            initial={false}
            animate={{ width: `${((step + 1) / stepCount) * 100}%` }}
            transition={transition}
          />
        </div>
        <h3 className="font-semibold text-foreground pr-6 mb-2 text-base leading-snug">{t(titleKey)}</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">{t(bodyKey)}</p>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            {t("tourSkip")}
          </Button>
          {isLast ? (
            <Button type="button" size="sm" onClick={onClose}>
              {t("tourDone")}
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={onNext}>
              {t("tourNext")}
            </Button>
          )}
        </div>
      </motion.div>
    </>
  );

  return createPortal(overlay, document.body);
}

export const PRODUCT_TOUR_STORAGE_KEY = "dyskiof_product_tour_v1_done";
/** One-time guest tour on home (not logged in). */
export const GUEST_TOUR_STORAGE_KEY = "dyskiof_guest_tour_v1_done";
