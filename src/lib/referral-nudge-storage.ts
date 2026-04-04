const PERIODIC_DISMISS_KEY = "referral_nudge_periodic_dismissed_at";
const FIRST_PURCHASE_DISMISS_KEY = "referral_nudge_first_purchase_dismissed";

/** Cooldown after user dismisses the periodic referral banner (ms). */
export const REFERRAL_NUDGE_PERIODIC_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export function getPeriodicDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERIODIC_DISMISS_KEY);
    if (!raw) return null;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export function dismissPeriodicNudge(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PERIODIC_DISMISS_KEY, new Date().toISOString());
  } catch {
    // ignore
  }
}

export function shouldShowPeriodicNudge(now: number = Date.now()): boolean {
  const at = getPeriodicDismissedAt();
  if (at == null) return true;
  return now - at >= REFERRAL_NUDGE_PERIODIC_COOLDOWN_MS;
}

export function hasDismissedFirstPurchaseNudge(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(FIRST_PURCHASE_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissFirstPurchaseNudge(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FIRST_PURCHASE_DISMISS_KEY, "1");
  } catch {
    // ignore
  }
}
