"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { setRefCookie } from "@/lib/referral-cookie";

/**
 * Captures ?ref= from URL and persists in cookie (Last Click Wins).
 * Runs on every page so referral intent is preserved across navigation.
 */
export function ReferralCookieProvider() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) {
      setRefCookie(ref);
    }
  }, [searchParams]);

  return null;
}
