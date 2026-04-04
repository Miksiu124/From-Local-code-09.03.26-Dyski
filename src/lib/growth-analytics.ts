/**
 * Growth funnel helpers → POST /api/growth-hacker (see growth-events.ts).
 * Event names: lowercase [a-z0-9_], max 128 chars; no PII in props.
 */

import { emitGrowthEvent, type GrowthProps } from "@/lib/growth-events";

export type { GrowthProps } from "@/lib/growth-events";
export { emitGrowthEvent, emitSessionStart } from "@/lib/growth-events";

const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

/** Dev console breadcrumb; optional server event when NEXT_PUBLIC_GROWTH_INSIGHT=1 */
export function growthInsight(tag: string, props: GrowthProps = {}): void {
  if (isDev && typeof console !== "undefined" && console.debug) {
    console.debug(`[growth-insight] ${tag}`, props);
  }
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_GROWTH_INSIGHT === "1") {
    emitGrowthEvent("growth_insight", { tag, ...props });
  }
}

/** Register page mounted */
export function trackSignupPageViewed(extra: GrowthProps = {}): void {
  growthInsight("signup_page", extra);
  emitGrowthEvent("signup_viewed", { surface: "register", ...extra });
}

/** User submitted the signup form (before API response) */
export function trackSignupSubmitAttempt(extra: GrowthProps = {}): void {
  emitGrowthEvent("signup_submit_attempt", { surface: "register", ...extra });
}

/** Registration API returned success (no email in props) */
export function trackSignupCompleted(extra: GrowthProps = {}): void {
  emitGrowthEvent("signup_completed", { surface: "register", ...extra });
}

/** Login page mounted */
export function trackLoginPageViewed(extra: GrowthProps = {}): void {
  growthInsight("login_page", extra);
  emitGrowthEvent("login_viewed", { surface: "login", ...extra });
}

/** Login API returned success */
export function trackLoginSuccess(extra: GrowthProps = {}): void {
  emitGrowthEvent("login_success", { surface: "login", ...extra });
}

export type LoginFailReason =
  | "email_not_verified"
  | "invalid_credentials"
  | "rate_limited"
  | "api_error"
  | "network";

/** Login API failed or network error (no raw messages) */
export function trackLoginFailed(reason: LoginFailReason, extra: GrowthProps = {}): void {
  emitGrowthEvent("login_failed", { surface: "login", reason, ...extra });
}

/** Explicit logout (POST /api/auth/logout) */
export function trackLogout(extra: GrowthProps = {}): void {
  emitGrowthEvent("logout", { surface: "header", ...extra });
}

/** First playback start for this content item in the tab session (see sessionStorage in video player) */
export function trackVideoPlayStarted(contentItemId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent("video_play_started", {
    content_item_id: contentItemId,
    ...extra,
  });
}

/** Second and later plays of the same item in the same tab session */
export function trackVideoPlaySubsequent(contentItemId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent("video_play_subsequent", {
    content_item_id: contentItemId,
    ...extra,
  });
}

/** Home / catalog grid viewed once per tab session */
export function trackCatalogViewed(extra: GrowthProps = {}): void {
  emitGrowthEvent("catalog_viewed", { surface: "home", ...extra });
}

/** Model profile page mounted */
export function trackModelPageViewed(modelId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent("model_page_viewed", { model_id: modelId, ...extra });
}

/** User toggled favorite on a content item (after API success) */
export function trackFavoriteToggled(
  contentItemId: string,
  favorited: boolean,
  extra: GrowthProps = {},
): void {
  emitGrowthEvent("favorite_toggled", {
    content_item_id: contentItemId,
    favorited,
    ...extra,
  });
}

/** Client-side validation before register API (password mismatch, length, …) */
export function trackSignupClientFailed(field: string, extra: GrowthProps = {}): void {
  emitGrowthEvent("signup_failed", {
    surface: "register",
    reason: "client_validation",
    field,
    ...extra,
  });
}

/** Map API failure to a small reason (no raw message — avoid PII / noise in props) */
export function trackSignupFailed(httpStatus: number, message: string, extra: GrowthProps = {}): void {
  const m = (message || "").toLowerCase();
  let reason = "unknown";
  if (httpStatus === 0) reason = "network";
  else if (httpStatus === 429) reason = "rate_limited";
  else if (m.includes("already") || m.includes("exists") || m.includes("registered")) reason = "email_taken";
  else if (m.includes("captcha") || m.includes("turnstile") || m.includes("verification")) reason = "captcha";
  else if (httpStatus === 400) reason = "validation";
  else if (httpStatus === 401 || httpStatus === 403) reason = "auth_error";
  emitGrowthEvent("signup_failed", {
    surface: "register",
    http_status: httpStatus,
    reason,
    ...extra,
  });
}

/** Purchase row created (POST /api/credits/purchase success) */
export function trackPurchaseCreated(purchaseId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent("purchase_created", { surface: "credit_purchase", purchase_id: purchaseId, ...extra });
}

/** Credits applied after payment approved */
export function trackCreditsCredited(purchaseId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent("credits_credited", { surface: "credit_purchase", purchase_id: purchaseId, ...extra });
}

/** Create-purchase API returned error or fetch failed */
export function trackPurchaseApiError(
  httpStatus: number,
  extra: GrowthProps & { tier?: number; error_class?: string } = {},
): void {
  emitGrowthEvent("purchase_api_error", {
    surface: "credit_purchase",
    http_status: httpStatus,
    ...extra,
  });
}

/** Admin/system rejected the payment */
export function trackPaymentRejected(purchaseId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent("payment_failed", {
    surface: "credit_purchase",
    purchase_id: purchaseId,
    reason: "rejected",
    ...extra,
  });
}

/** User left while still waiting for payment confirmation */
export function trackPaymentAbandoned(
  purchaseId: string,
  trigger: "unmount" | "pagehide",
  extra: GrowthProps = {},
): void {
  emitGrowthEvent("payment_abandoned", {
    surface: "credit_purchase",
    purchase_id: purchaseId,
    trigger,
    ...extra,
  });
}

/** Promo code validated successfully (no code string in props) */
export function trackPromoApplied(extra: GrowthProps = {}): void {
  emitGrowthEvent("promo_applied", { surface: "credit_purchase", ...extra });
}

export function trackPromoFailed(extra: GrowthProps = {}): void {
  emitGrowthEvent("promo_failed", { surface: "credit_purchase", ...extra });
}

/** Proof of payment file uploaded successfully */
export function trackPaymentProofUploaded(purchaseId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent("proof_uploaded", { surface: "credit_purchase", purchase_id: purchaseId, ...extra });
}

/** User left the purchase flow before approval (unmount while past package selection) */
export function trackCheckoutAbandoned(
  step: string,
  extra: GrowthProps & { tier?: number; method?: string | null } = {},
): void {
  emitGrowthEvent("checkout_abandoned", { surface: "credit_purchase", step, ...extra });
}

/** BLIK code expired while waiting for admin approval */
export function trackBlikPaymentExpired(extra: GrowthProps = {}): void {
  emitGrowthEvent("blik_payment_expired", { surface: "credit_purchase", ...extra });
}

/** Referral program prompt shown (first purchase success screen or periodic banner). */
export function trackReferralProgramNudge(
  surface: "first_purchase_success" | "periodic_banner",
  action: "shown" | "dismissed" | "cta_click",
  extra: GrowthProps = {},
): void {
  emitGrowthEvent("referral_program_nudge", { surface, action, ...extra });
}
