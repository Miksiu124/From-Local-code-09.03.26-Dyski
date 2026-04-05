const MODAL_DISMISS_KEY = "referral_promo_modal_dismissed_at";

/** Cooldown after user taps "Later" on the referral promo modal (ms). */
export const REFERRAL_MODAL_COOLDOWN_MS = 21 * 24 * 60 * 60 * 1000;

/** Session: modal was auto-shown once (don't repeat on client navigations). */
export const SESSION_MODAL_AUTO_KEY = "gf_referral_modal_auto_shown";

/** Session: suppress periodic referral banner while/when promo modal was used. */
export const SESSION_BANNER_SUPPRESS_KEY = "gf_referral_banner_suppress_modal";

export function getModalDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MODAL_DISMISS_KEY);
    if (!raw) return null;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export function dismissReferralPromoModal(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MODAL_DISMISS_KEY, new Date().toISOString());
  } catch {
    // ignore
  }
}

export function shouldShowReferralPromoModal(now: number = Date.now()): boolean {
  const at = getModalDismissedAt();
  if (at == null) return true;
  return now - at >= REFERRAL_MODAL_COOLDOWN_MS;
}

export function markModalAutoShownThisSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_MODAL_AUTO_KEY, "1");
    sessionStorage.setItem(SESSION_BANNER_SUPPRESS_KEY, "1");
  } catch {
    // ignore
  }
}

export function hasAutoShownModalThisSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(SESSION_MODAL_AUTO_KEY) === "1";
  } catch {
    return false;
  }
}
