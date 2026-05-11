# Email lifecycle: segments, events, suppression

This document maps the **Revenue-First Email + Transactional** blueprint to this codebase: `growth_events`, `marketing_campaign_sends`, `marketing_trigger_fires`, and Resend/SMTP.

## Canonical funnel events (client + server)

| Event | Source | Used for |
|-------|--------|----------|
| `signup_completed` | Client after register | Funnel, starter-offer window |
| `verification_sent` | Server (register / resend) | Deliverability diagnostics |
| `email_verified` | Server (verify link) or Discord new user | Welcome Day 0, verified_at for starter offer |
| `checkout_started` | Client | Checkout abandonment cron |
| `purchase_completed` | Server (admin approve credits) | Buyer segments, suppress starter/winback paths |
| `purchase_rejected` | Server | Optional analytics |
| `first_play`, `content_detail_view`, `video_engagement` | Client | Social proof re-engage eligibility |

Full list: [`src/lib/growth-event-names.ts`](../src/lib/growth-event-names.ts) and backend validation in `internal/growth/`.

### Optional server-only audit events

After certain sends, the backend may insert:

| Event | When |
|-------|------|
| `lifecycle_welcome_sent` | After welcome-value marketing template send |
| `lifecycle_starter_offer_sent` | After starter-offer template send |

These power attribution and caps; they are **not** required for cron eligibility (cron uses `marketing_campaign_sends`).

## Segment definitions (logical)

| Segment ID | Rule (simplified) |
|------------|-------------------|
| `new_free_user_0_7d` | `email_verified`, no `purchase_completed`, account age ≤ 7d |
| `engaged_non_buyer` | Engagement events in lookback, no purchase, verified |
| `new_buyer_0_14d` | First `purchase_completed` or approved `credit_purchases` ≤ 14d |
| `active_subscriber` | Buyer + recent login or growth activity ≤ 14d (operational / future use) |
| `at_risk_subscriber` | Ever purchased, inactive between configured min/max days |
| `lapsed_buyer` | Ever purchased, deeper inactivity band before long winback |
| `lapsed_15_45d` | Same as lapsed band (configurable days) |
| `vip_high_ltv` | Future: top percentile by spend (not automated in v1) |

## Campaign → table keys

| Campaign key (`marketing_campaign_sends.campaign`) | Template slug (default) | Channel |
|----------------------------------------------------|-------------------------|---------|
| `welcome_value_v1` | `welcome-value-stack` | Marketing (opt-in) |
| `starter_offer_v1` | `starter-offer-welcome` | Marketing |
| `social_proof_drop` | `social-proof-drop` | Marketing |
| `winback_soft` | `winback-soft` | Marketing |
| `at_risk_paid_v1` | `at-risk-retention` | Marketing |
| `lapsed_buyer_v1` | `lapsed-buyer-comeback` | Marketing |
| `repeat_buyer_promo_v1` | `repeat-buyer-10` | Marketing |
| `favorite_nudge_v1` | `favorite-nudge` | Marketing |

Transactional emails do **not** use `marketing_campaign_sends` (no unsubscribe footer); they use `Mailer.Send*` with `SMTP_FROM` / optional `TRANSACTIONAL_EMAIL_FROM`.

**Renewal reminder (plan):** brak osobnej subskrypcji rozliczanej cyklicznie w tym produkcie (kredyty + jednorazowe zakupy) — przypomnienie „przed odnowieniem” nie jest wysyłane automatycznie; można dodać później przy modelu membership.

## Suppression & guardrails

1. **Marketing opt-out**: `users.marketing_email_opt_in = false` → skip all marketing templates (welcome, starter, social proof, winback, at-risk, lapsed, repeat buyer, favorite nudge).
2. **Unverified email**: no marketing sends.
3. **Admin / banned**: excluded in SQL.
4. **Cooldowns**: each campaign has `NOT EXISTS` recent row in `marketing_campaign_sends` for same `(user_id, campaign)`.
5. **Weekly volume cap** (lifecycle): `COUNT(*) FROM marketing_campaign_sends WHERE user_id = … AND sent_at > now() - interval '7 days' AND campaign IN (welcome_value_v1, starter_offer_v1, at_risk_paid_v1, lapsed_buyer_v1, social_proof_drop, winback_soft)` **&lt; 5** inside candidate queries (tunable).
6. **Transactional**: sent regardless of `marketing_email_opt_in` where legally required (verification, password reset, payment outcome).

## Deliverability notes

- Use a verified domain in Resend; consider `MARKETING_EMAIL_FROM` for marketing and `SMTP_FROM` (or `TRANSACTIONAL_EMAIL_FROM`) for transactional.
- Copy stays **PG-safe teaser**; explicit content stays on-site after login.
