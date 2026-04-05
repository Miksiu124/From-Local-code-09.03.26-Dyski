"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ProductTour,
  PRODUCT_TOUR_STORAGE_KEY,
  GUEST_TOUR_STORAGE_KEY,
  type ProductTourMode,
} from "@/components/onboarding/product-tour";

/**
 * Home page spotlight tour: guests get a 5-step intro (incl. pricing link); logged-in non-admins get the member tour.
 */
export function ProductTourAutostart() {
  const pathname = usePathname();
  const [user, setUser] = useState<{ role?: string } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [tourMode, setTourMode] = useState<ProductTourMode | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          if (!cancelled) setUser(null);
          return;
        }
        const data = await res.json();
        if (!cancelled) setUser(data);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (!sessionReady) return;
    if (pathname !== "/") return;
    if (typeof window === "undefined") return;

    setTourMode(null);
    setStep(0);

    const delay = 700;

    if (user && user.role !== "ADMIN") {
      if (localStorage.getItem(PRODUCT_TOUR_STORAGE_KEY) === "1") return;
      const t = window.setTimeout(() => {
        setStep(0);
        setTourMode("member");
      }, delay);
      return () => clearTimeout(t);
    }

    if (!user) {
      if (localStorage.getItem(GUEST_TOUR_STORAGE_KEY) === "1") return;
      const t = window.setTimeout(() => {
        setStep(0);
        setTourMode("guest");
      }, delay);
      return () => clearTimeout(t);
    }

    return undefined;
  }, [user, pathname, sessionReady]);

  useEffect(() => {
    if (pathname !== "/") setTourMode(null);
  }, [pathname]);

  /** If user logs in while guest tour is open, close it and mark guest tour complete. */
  useEffect(() => {
    if (!sessionReady) return;
    if (user && tourMode === "guest") {
      localStorage.setItem(GUEST_TOUR_STORAGE_KEY, "1");
      setTourMode(null);
    }
  }, [user, sessionReady, tourMode]);

  const finish = (mode: ProductTourMode) => {
    if (mode === "member") {
      localStorage.setItem(PRODUCT_TOUR_STORAGE_KEY, "1");
    } else {
      localStorage.setItem(GUEST_TOUR_STORAGE_KEY, "1");
    }
    setTourMode(null);
  };

  if (!tourMode) return null;

  const maxStep = tourMode === "guest" ? 4 : 3;

  return (
    <ProductTour
      mode={tourMode}
      open
      step={step}
      onNext={() => setStep((s) => Math.min(s + 1, maxStep))}
      onSkip={() => finish(tourMode)}
      onClose={() => finish(tourMode)}
    />
  );
}
