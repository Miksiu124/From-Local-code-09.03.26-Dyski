"use client";

import { useCallback, useEffect, useRef } from "react";
import { trackModelProfileEngagement } from "@/lib/growth-analytics";

const DEEP_MIN_SEC = 20;
const DEEP_MIN_SCROLL_PCT = 25;

/**
 * Jedno zdarzenie model_profile_engagement na wizytę (flush przy wyjściu / ukryciu karty).
 * Uzupełnij markFavorite / markContentOpen przy akcjach na stronie profilu.
 */
export function useModelProfileEngagement(modelId: string, folderName: string) {
  const startRef = useRef(Date.now());
  const maxScrollRef = useRef(0);
  const secondaryRef = useRef({ favorite: false, contentOpen: false });
  const sentRef = useRef(false);

  const flush = useCallback(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    const rawSec = Math.round((Date.now() - startRef.current) / 1000);
    const duration_sec = Math.min(3600, Math.max(0, rawSec));
    const scroll_max_pct = Math.min(100, Math.max(0, maxScrollRef.current));
    const deep_engaged = duration_sec >= DEEP_MIN_SEC || scroll_max_pct >= DEEP_MIN_SCROLL_PCT;
    trackModelProfileEngagement(modelId, folderName, {
      duration_sec,
      scroll_max_pct,
      deep_engaged,
      secondary_favorite: secondaryRef.current.favorite,
      secondary_content_open: secondaryRef.current.contentOpen,
      flush_kind: "final",
    });
  }, [modelId, folderName]);

  const markFavorite = useCallback(() => {
    secondaryRef.current.favorite = true;
  }, []);

  const markContentOpen = useCallback(() => {
    secondaryRef.current.contentOpen = true;
  }, []);

  useEffect(() => {
    startRef.current = Date.now();
    sentRef.current = false;
    maxScrollRef.current = 0;
    secondaryRef.current = { favorite: false, contentOpen: false };

    const onScroll = () => {
      const h = document.documentElement;
      const total = h.scrollHeight - h.clientHeight;
      const pct = total <= 0 ? 100 : Math.round((h.scrollTop / total) * 100);
      maxScrollRef.current = Math.max(maxScrollRef.current, Math.min(100, pct));
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [modelId, folderName, flush]);

  return { markFavorite, markContentOpen };
}
