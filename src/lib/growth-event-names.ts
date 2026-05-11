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
  /** Karta modelki widoczna w katalogu (IntersectionObserver; props: model_id, folder_name, surface, …) */
  CATALOG_MODEL_IMPRESSION: "catalog_model_impression",
  /** Klik w kartę / hero / featured side (props: outcome open | login_required) */
  CATALOG_MODEL_CLICK: "catalog_model_click",
  /** Ta sama karta co impression, ale po ~0,9 s ciągłej widoczności w viewport (dedupe per tab) */
  CATALOG_MODEL_ENGAGED_IMPRESSION: "catalog_model_engaged_impression",
  /** Koniec wizyty na profilu modelki: czas, scroll, „głębokie” zaangażowanie, akcje wtórne (props: duration_sec, …) */
  MODEL_PROFILE_ENGAGEMENT: "model_profile_engagement",

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
  /** Klik w miniaturę na siatce folderu modelu (props: outcome, filter, sort, content_item_id) */
  CONTENT_THUMB_CLICK: "content_thumb_click",
  /** Przejście na inny materiał w fullscreen overlay (prev/next/swipe/kbd/load_more) */
  CONTENT_OVERLAY_NAV: "content_overlay_nav",
  /** Zakończenie sesji oglądania wideo: max. sekund obejrzanych (props: watched_seconds, duration_seconds) */
  VIDEO_ENGAGEMENT: "video_engagement",
  /** Pełny widok treści (overlay modelu / strona / ulubione) — props: surface, content_type */
  CONTENT_DETAIL_VIEW: "content_detail_view",

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
  REFERRAL_PANEL_VIEWED: "referral_panel_viewed",

  // Inne
  FAVORITE_TOGGLED: "favorite_toggled",
  GROWTH_INSIGHT: "growth_insight",

  /** Serwer: po wysłaniu szablonu welcome-value (audyt + KPI) */
  LIFECYCLE_WELCOME_SENT: "lifecycle_welcome_sent",
  /** Serwer: starter offer (cron) */
  LIFECYCLE_STARTER_OFFER_SENT: "lifecycle_starter_offer_sent",
  /** Serwer: at-risk paid (cron) */
  LIFECYCLE_AT_RISK_SENT: "lifecycle_at_risk_sent",
  /** Serwer: lapsed buyer (cron) */
  LIFECYCLE_LAPSED_SENT: "lifecycle_lapsed_sent",
} as const;

export type GrowthEventName = (typeof GROWTH)[keyof typeof GROWTH];
