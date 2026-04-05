/**
 * Growth funnel helpers → POST /api/growth-hacker (see growth-events.ts).
 * Używaj stałych GROWTH.* dla spójnych nazw zdarzeń.
 */

import { emitGrowthEvent, type GrowthProps } from "@/lib/growth-events";
import { GROWTH } from "@/lib/growth-event-names";

export type { GrowthProps } from "@/lib/growth-events";
export { emitGrowthEvent, emitSessionStart } from "@/lib/growth-events";
export { GROWTH } from "@/lib/growth-event-names";

const isDev =
  typeof process !== "undefined" && process.env.NODE_ENV === "development";

/** Dev console breadcrumb; opcjonalnie server gdy NEXT_PUBLIC_GROWTH_INSIGHT=1 */
export function growthInsight(tag: string, props: GrowthProps = {}): void {
  if (isDev && typeof console !== "undefined" && console.debug) {
    console.debug(`[growth-insight] ${tag}`, props);
  }
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_GROWTH_INSIGHT === "1") {
    emitGrowthEvent(GROWTH.GROWTH_INSIGHT, { tag, ...props });
  }
}

/** Wejście na stronę rejestracji (lejek: signup_started) */
export function trackSignupPageViewed(extra: GrowthProps = {}): void {
  growthInsight("signup_page", extra);
  emitGrowthEvent(GROWTH.SIGNUP_STARTED, { surface: "register", phase: "page", ...extra });
}

/** Wysłanie formularza (opcjonalnie; nie dublować licznika — osobna faza) */
export function trackSignupSubmitAttempt(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.SIGNUP_STARTED, { surface: "register", phase: "submit", ...extra });
}

export function trackSignupCompleted(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.SIGNUP_COMPLETED, { surface: "register", ...extra });
}

export function trackLoginPageViewed(extra: GrowthProps = {}): void {
  growthInsight("login_page", extra);
  emitGrowthEvent(GROWTH.LOGIN_VIEWED, { surface: "login", ...extra });
}

export function trackLoginSuccess(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.LOGIN_SUCCESS, { surface: "login", ...extra });
}

export type LoginFailReason =
  | "email_not_verified"
  | "invalid_credentials"
  | "rate_limited"
  | "api_error"
  | "network";

export function trackLoginFailed(reason: LoginFailReason, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.LOGIN_FAILED, { surface: "login", reason, ...extra });
}

export function trackLogout(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.LOGOUT, { surface: "header", ...extra });
}

/** Pierwsze odtworzenie wideo dla danego content_item w sesji karty */
export function trackFirstPlay(contentItemId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.FIRST_PLAY, {
    content_item_id: contentItemId,
    ...extra,
  });
}

/** Kolejne odtworzenia tego samego materiału w sesji */
export function trackVideoPlayRepeat(contentItemId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.VIDEO_PLAY_REPEAT, {
    content_item_id: contentItemId,
    ...extra,
  });
}

/** @deprecated użyj trackFirstPlay / trackVideoPlayRepeat */
export function trackVideoPlayStarted(contentItemId: string, extra: GrowthProps = {}): void {
  trackFirstPlay(contentItemId, extra);
}

/** @deprecated użyj trackVideoPlayRepeat */
export function trackVideoPlaySubsequent(contentItemId: string, extra: GrowthProps = {}): void {
  trackVideoPlayRepeat(contentItemId, extra);
}

/** Strona główna z katalogiem modeli (raz na sesję — wołające miejsce pilnuje tego) */
export function trackCatalogHomeViewed(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.CATALOG_HOME_VIEWED, { surface: "home", ...extra });
}

/** @deprecated użyj trackCatalogHomeViewed */
export function trackCatalogViewed(extra: GrowthProps = {}): void {
  trackCatalogHomeViewed(extra);
}

export function trackCatalogFilterUsed(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.CATALOG_FILTER_USED, extra);
}

export function trackSearchUsed(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.SEARCH_USED, extra);
}

export function trackModelPageViewed(modelId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.MODEL_PAGE_VIEWED, { model_id: modelId, ...extra });
}

export function trackFavoriteToggled(
  contentItemId: string,
  favorited: boolean,
  extra: GrowthProps = {},
): void {
  emitGrowthEvent(GROWTH.FAVORITE_TOGGLED, {
    content_item_id: contentItemId,
    favorited,
    ...extra,
  });
}

export function trackPhotoViewFirst(contentItemId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.PHOTO_VIEW_FIRST, {
    content_item_id: contentItemId,
    ...extra,
  });
}

export function trackSignupClientFailed(field: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.SIGNUP_FAILED, {
    surface: "register",
    reason: "client_validation",
    field,
    ...extra,
  });
}

export function trackSignupFailed(httpStatus: number, message: string, extra: GrowthProps = {}): void {
  const m = (message || "").toLowerCase();
  let reason = "unknown";
  if (httpStatus === 0) reason = "network";
  else if (httpStatus === 429) reason = "rate_limited";
  else if (m.includes("already") || m.includes("exists") || m.includes("registered")) reason = "email_taken";
  else if (m.includes("captcha") || m.includes("turnstile") || m.includes("verification")) reason = "captcha";
  else if (httpStatus === 400) reason = "validation";
  else if (httpStatus === 401 || httpStatus === 403) reason = "auth_error";
  emitGrowthEvent(GROWTH.SIGNUP_FAILED, {
    surface: "register",
    http_status: httpStatus,
    reason,
    ...extra,
  });
}

export function trackPurchaseCreated(purchaseId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.PURCHASE_CREATED, { surface: "credit_purchase", purchase_id: purchaseId, ...extra });
}

export function trackCreditsCredited(purchaseId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.CREDITS_CREDITED, { surface: "credit_purchase", purchase_id: purchaseId, ...extra });
}

export function trackPurchaseApiError(
  httpStatus: number,
  extra: GrowthProps & { tier?: number; error_class?: string } = {},
): void {
  emitGrowthEvent(GROWTH.PURCHASE_API_ERROR, {
    surface: "credit_purchase",
    http_status: httpStatus,
    ...extra,
  });
}

export function trackPaymentRejected(purchaseId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.PAYMENT_FAILED, {
    surface: "credit_purchase",
    purchase_id: purchaseId,
    reason: "rejected",
    ...extra,
  });
}

export function trackPaymentAbandoned(
  purchaseId: string,
  trigger: "unmount" | "pagehide",
  extra: GrowthProps = {},
): void {
  emitGrowthEvent(GROWTH.PAYMENT_ABANDONED, {
    surface: "credit_purchase",
    purchase_id: purchaseId,
    trigger,
    ...extra,
  });
}

export function trackPromoApplied(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.PROMO_APPLIED, { surface: "credit_purchase", ...extra });
}

export function trackPromoFailed(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.PROMO_FAILED, { surface: "credit_purchase", ...extra });
}

export function trackPaymentProofUploaded(purchaseId: string, extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.PROOF_UPLOADED, { surface: "credit_purchase", purchase_id: purchaseId, ...extra });
}

export function trackCheckoutAbandoned(
  step: string,
  extra: GrowthProps & { tier?: number; method?: string | null } = {},
): void {
  emitGrowthEvent(GROWTH.CHECKOUT_ABANDONED, { surface: "credit_purchase", step, ...extra });
}

export function trackBlikPaymentExpired(extra: GrowthProps = {}): void {
  emitGrowthEvent(GROWTH.BLIK_PAYMENT_EXPIRED, { surface: "credit_purchase", ...extra });
}

/** Modal / banner referral — jasne nazwy jak na panelu */
export function trackReferralPromptShown(
  surface: "first_purchase_success" | "periodic_banner" | "promo_modal",
  extra: GrowthProps = {},
): void {
  emitGrowthEvent(GROWTH.REFERRAL_PROMPT_SHOWN, { surface, ...extra });
}

export function trackReferralPromptDismissed(
  surface: "first_purchase_success" | "periodic_banner" | "promo_modal",
  extra: GrowthProps = {},
): void {
  emitGrowthEvent(GROWTH.REFERRAL_PROMPT_DISMISSED, { surface, ...extra });
}

export function trackReferralPromptCta(
  surface: "first_purchase_success" | "periodic_banner" | "promo_modal",
  extra: GrowthProps = {},
): void {
  emitGrowthEvent(GROWTH.REFERRAL_PROMPT_CTA, { surface, ...extra });
}

/** @deprecated użyj trackReferralPromptShown / Dismissed / Cta */
export function trackReferralProgramNudge(
  surface: "first_purchase_success" | "periodic_banner" | "promo_modal",
  action: "shown" | "dismissed" | "cta_click",
  extra: GrowthProps = {},
): void {
  if (action === "dismissed") trackReferralPromptDismissed(surface, extra);
  else if (action === "cta_click") trackReferralPromptCta(surface, extra);
  else trackReferralPromptShown(surface, extra);
}
