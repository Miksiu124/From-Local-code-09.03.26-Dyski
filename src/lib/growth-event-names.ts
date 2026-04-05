/**
 * Kanoniczne nazwy zdarzeń lejka (POST /api/growth-hacker).
 * Muszą pasować do walidacji backendu: ^[a-z][a-z0-9_]{0,127}$
 */
export const GROWTH = {
  // Sesja i katalog
  SESSION_START: "session_start",
  CATALOG_HOME_VIEWED: "catalog_home_viewed",
  CATALOG_FILTER_USED: "catalog_filter_used",
  SEARCH_USED: "search_used",
  MODEL_PAGE_VIEWED: "model_page_viewed",

  // Rejestracja / logowanie
  SIGNUP_STARTED: "signup_started",
  SIGNUP_COMPLETED: "signup_completed",
  SIGNUP_FAILED: "signup_failed",
  LOGIN_VIEWED: "login_viewed",
  LOGIN_SUCCESS: "login_success",
  LOGIN_FAILED: "login_failed",
  LOGOUT: "logout",

  // Weryfikacja e-mail (część tylko z backendu)
  EMAIL_VERIFIED: "email_verified",
  VERIFICATION_SENT: "verification_sent",

  // Odtwarzanie / treść
  FIRST_PLAY: "first_play",
  PHOTO_VIEW_FIRST: "photo_view_first",
  VIDEO_PLAY_REPEAT: "video_play_repeat",
  CONTENT_UNLOCKED: "content_unlocked",

  // Zakupy kredytów
  PRICING_VIEWED: "pricing_viewed",
  CHECKOUT_STARTED: "checkout_started",
  PAYMENT_METHOD_SELECTED: "payment_method_selected",
  PURCHASE_COMPLETED: "purchase_completed",
  PURCHASE_CREATED: "purchase_created",
  CREDITS_CREDITED: "credits_credited",
  PURCHASE_API_ERROR: "purchase_api_error",
  PAYMENT_FAILED: "payment_failed",
  PAYMENT_ABANDONED: "payment_abandoned",
  PROMO_APPLIED: "promo_applied",
  PROMO_FAILED: "promo_failed",
  PROOF_UPLOADED: "proof_uploaded",
  CHECKOUT_ABANDONED: "checkout_abandoned",
  BLIK_PAYMENT_EXPIRED: "blik_payment_expired",

  // Referrale (UI)
  REFERRAL_PROMPT_SHOWN: "referral_prompt_shown",
  REFERRAL_PROMPT_DISMISSED: "referral_prompt_dismissed",
  REFERRAL_PROMPT_CTA: "referral_prompt_cta",

  // Inne
  FAVORITE_TOGGLED: "favorite_toggled",
  GROWTH_INSIGHT: "growth_insight",
} as const;

export type GrowthEventName = (typeof GROWTH)[keyof typeof GROWTH];
