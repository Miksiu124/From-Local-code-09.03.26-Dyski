"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Single id or fallback chain — first matching element with non-zero layout wins (fixes hidden `md:` / `sm:` targets on mobile). */
type TourStepTarget = string | readonly string[];

const STEP_TARGETS_MEMBER: readonly TourStepTarget[] = [
  ["tour-models", "tour-models-mobile"],
  ["tour-credits", "tour-credits-mobile"],
  ["tour-buy", "tour-buy-mobile"],
  "tour-account",
];
const STEP_TARGETS_GUEST: readonly TourStepTarget[] = [
  ["tour-models", "tour-models-mobile"],
  "tour-guest-search",
  ["tour-guest-filters", "tour-guest-search"],
  "tour-guest-credits",
  "tour-guest-auth",
];

export type ProductTourMode = "member" | "guest";

type Rect = { top: number; left: number; width: number; height: number };

const CARD_W_MAX_PX = 352; /* 22rem */
const CARD_EST_HEIGHT = 260;
const CARD_GAP = 12;

function resolveStepIds(step: TourStepTarget): readonly string[] {
  return typeof step === "string" ? [step] : [...step];
}

/** Prefer stable #id anchors — data-tour on wrappers can resolve to wrong rects during layout/animation. */
const TOUR_ANCHOR_ID: Partial<Record<string, string>> = {
  "tour-guest-search": "catalog-search",
  "tour-guest-filters": "catalog-country",
};

function rectFromElement(el: Element): Rect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Highlight the whole search row (icon + field), not a phantom box elsewhere. */
function rectForSearchTour(inputEl: HTMLElement): Rect | null {
  const row = inputEl.parentElement;
  if (row) {
    const r = row.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2) {
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }
  }
  return rectFromElement(inputEl);
}

/** Catalog steps must live in <main> — never match a stray node outside content. */
function tourNodeAllowedForId(el: Element, tourId: string): boolean {
  if (tourId === "tour-guest-search" || tourId === "tour-guest-filters") {
    return Boolean(el.closest("main"));
  }
  return true;
}

function measureTargets(ids: readonly string[]): Rect | null {
  if (typeof document === "undefined") return null;
  for (const id of ids) {
    const anchorId = TOUR_ANCHOR_ID[id];
    if (anchorId) {
      const el = document.getElementById(anchorId);
      if (el) {
        if (id === "tour-guest-search" && el instanceof HTMLElement) {
          const r = rectForSearchTour(el);
          if (r) return r;
        } else {
          const r = rectFromElement(el);
          if (r) return r;
        }
      }
    }
    const nodes = document.querySelectorAll(`[data-tour="${id}"]`);
    for (const el of nodes) {
      if (!tourNodeAllowedForId(el, id)) continue;
      const r = rectFromElement(el);
      if (r) return r;
    }
  }
  return null;
}

function firstVisibleTargetEl(ids: readonly string[]): Element | null {
  if (typeof document === "undefined") return null;
  for (const id of ids) {
    const anchorId = TOUR_ANCHOR_ID[id];
    if (anchorId) {
      const el = document.getElementById(anchorId);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width >= 2 && r.height >= 2) return el;
      }
    }
    const nodes = document.querySelectorAll(`[data-tour="${id}"]`);
    for (const el of nodes) {
      if (!tourNodeAllowedForId(el, id)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 2 && r.height >= 2) return el;
    }
  }
  return null;
}

/** Avoid full-page “snap” when switching between header targets and main content (steps 2↔3). */
function isTargetMostlyVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const pad = 48;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (r.width < 2 || r.height < 2) return false;
  return (
    r.top >= -pad &&
    r.left >= -pad &&
    r.bottom <= vh + pad &&
    r.right <= vw + pad
  );
}

function scrollTargetIntoViewIfNeeded(el: Element) {
  // Search field: always bring into clear view (avoids “hole” over cookie / bottom chrome).
  if (el instanceof HTMLElement && el.id === "catalog-search") {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    return;
  }
  if (isTargetMostlyVisible(el)) return;
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
}

function TourCardBody({
  t,
  step,
  stepCount,
  titleKey,
  bodyKey,
  isLast,
  transition,
  onSkip,
  onNext,
  onClose,
}: {
  t: ReturnType<typeof useTranslations<"onboarding">>;
  step: number;
  stepCount: number;
  titleKey: string;
  bodyKey: string;
  isLast: boolean;
  transition: Transition;
  onSkip: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <>
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
      <div className="flex items-center justify-end gap-2 flex-wrap">
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
    </>
  );
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
  /** Spotlight/card: short ease on step change — spring between far-apart targets (e.g. krok 2→3) felt like a “bounce” jump. */
  const positionTransition = useMemo(
    () =>
      reduceMotion
        ? { duration: 0.18, ease: "easeOut" as const }
        : { type: "tween" as const, duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
    [reduceMotion],
  );

  const [rect, setRect] = useState<Rect | null>(null);
  const [narrowSheet, setNarrowSheet] = useState(false);

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
    const ids = resolveStepIds(targets[step]);
    setRect(measureTargets(ids));
  }, [open, step, stepCount, targets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setNarrowSheet(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /** Scroll target into view only when needed, then measure (avoids jarring center-scroll between header ↔ content). */
  useLayoutEffect(() => {
    if (!open || step < 0 || step >= stepCount) {
      setRect(null);
      return;
    }
    const ids = resolveStepIds(targets[step]);
    const el = firstVisibleTargetEl(ids);
    if (el) {
      scrollTargetIntoViewIfNeeded(el);
    }
    let raf1 = 0;
    let raf2 = 0;
    let raf3 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        raf3 = requestAnimationFrame(() => {
          setRect(measureTargets(ids));
        });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
    };
  }, [open, step, stepCount, targets]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => refresh();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", onResize);
      vv.addEventListener("scroll", onResize);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      if (vv) {
        vv.removeEventListener("resize", onResize);
        vv.removeEventListener("scroll", onResize);
      }
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

  const cardPos = rect && !narrowSheet ? computeCardPosition(rect) : null;

  const cardAnimateDesktop =
    cardPos != null
      ? { left: cardPos.left, top: cardPos.top, x: "-50%", y: 0, opacity: 1 }
      : { left: "50%", top: "50%", x: "-50%", y: "-50%", opacity: 1 };

  /**
   * Dimming without a full-screen backdrop-blur: that blur was stacking over the highlighted
   * control (even through the “hole”), so labels looked smeared. Four strips leave a true gap
   * so the target renders sharp; no frosted blur on the page.
   */
  const SPOTLIGHT_PAD = 4;
  const dimStripClass = "fixed z-[199] bg-black/55 cursor-default";

  const overlay = (
    <>
      {rect ? (
        (() => {
          const top = rect.top - SPOTLIGHT_PAD;
          const left = rect.left - SPOTLIGHT_PAD;
          const w = rect.width + SPOTLIGHT_PAD * 2;
          const h = rect.height + SPOTLIGHT_PAD * 2;
          return (
            <>
              <motion.div
                aria-hidden
                className={cn(dimStripClass, "left-0 right-0 top-0")}
                style={{ height: Math.max(0, top) }}
                initial={false}
                animate={{ opacity: 1 }}
                transition={positionTransition}
                onClick={onSkip}
              />
              <motion.div
                aria-hidden
                className={cn(dimStripClass, "left-0 right-0 bottom-0")}
                style={{ top: top + h }}
                initial={false}
                animate={{ opacity: 1 }}
                transition={positionTransition}
                onClick={onSkip}
              />
              <motion.div
                aria-hidden
                className={cn(dimStripClass, "left-0")}
                style={{ top, width: Math.max(0, left), height: h }}
                initial={false}
                animate={{ opacity: 1 }}
                transition={positionTransition}
                onClick={onSkip}
              />
              <motion.div
                aria-hidden
                className={cn(dimStripClass, "right-0")}
                style={{ top, left: left + w, height: h }}
                initial={false}
                animate={{ opacity: 1 }}
                transition={positionTransition}
                onClick={onSkip}
              />
            </>
          );
        })()
      ) : (
        <motion.div
          className="fixed inset-0 z-[199] cursor-default bg-black/55"
          aria-hidden
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: reduceMotion ? 0.15 : 0.28, ease: "easeOut" }}
          onClick={onSkip}
        />
      )}
      {rect && (
        <motion.div
          key={`spotlight-${step}`}
          className={cn(
            "fixed z-[200] rounded-xl pointer-events-none border-2 border-primary/80 tour-spotlight-pulse",
          )}
          initial={false}
          animate={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
          }}
          transition={positionTransition}
          style={{ willChange: reduceMotion ? undefined : "transform, width, height, top, left" }}
        />
      )}
      {narrowSheet ? (
        <motion.div
          key={`tour-sheet-${step}`}
          className={cn(
            "fixed z-[200] left-3 right-3 max-h-[min(42vh,300px)] overflow-y-auto rounded-2xl border border-white/[0.08] bg-card/95 backdrop-blur-xl shadow-2xl p-4 text-sm",
            "bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
          )}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={transition}
          style={{ willChange: reduceMotion ? undefined : "transform" }}
        >
          <TourCardBody
            t={t}
            step={step}
            stepCount={stepCount}
            titleKey={titleKey}
            bodyKey={bodyKey}
            isLast={isLast}
            transition={transition}
            onSkip={onSkip}
            onNext={onNext}
            onClose={onClose}
          />
        </motion.div>
      ) : (
        <motion.div
          key={`tour-card-${step}`}
          className={cn(
            "fixed z-[200] w-[min(92vw,22rem)] rounded-2xl border border-white/[0.08] bg-card/95 backdrop-blur-xl shadow-2xl p-4 text-sm",
          )}
          initial={false}
          animate={cardAnimateDesktop}
          transition={positionTransition}
          style={{ willChange: reduceMotion ? undefined : "transform, top, left" }}
        >
          <TourCardBody
            t={t}
            step={step}
            stepCount={stepCount}
            titleKey={titleKey}
            bodyKey={bodyKey}
            isLast={isLast}
            transition={transition}
            onSkip={onSkip}
            onNext={onNext}
            onClose={onClose}
          />
        </motion.div>
      )}
    </>
  );

  return createPortal(overlay, document.body);
}

export const PRODUCT_TOUR_STORAGE_KEY = "dyskiof_product_tour_v1_done";
/** One-time guest tour on home (not logged in). */
export const GUEST_TOUR_STORAGE_KEY = "dyskiof_guest_tour_v2_done";
