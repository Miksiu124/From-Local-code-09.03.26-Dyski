"use client";

import { useEffect } from "react";
import { emitSessionStart } from "@/lib/growth-events";

/** Registers session_start once per tab (and optional future funnel hooks). */
export function GrowthSessionTracker() {
  useEffect(() => {
    emitSessionStart();
  }, []);
  return null;
}
