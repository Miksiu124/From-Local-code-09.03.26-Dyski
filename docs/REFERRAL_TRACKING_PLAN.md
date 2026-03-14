# Referral Link Tracking – Project Plan

**Status:** Implemented  
**Date:** 2026-03-13  
**Verification:** See [REFERRAL_TRACKING_VERIFICATION.md](./REFERRAL_TRACKING_VERIFICATION.md)  
**Roles:** Project Manager, Senior Developer, UI Designer, Experimental Tracker, Evidence Collector, Reality Checker

---

## 1. Senior Project Manager – Requirements & Scope

### Goals
- **Clicks:** How many people clicked on referral links
- **Registrations:** How many made an account via the link
- **Purchases:** How many bought after registering via the link
- **Revenue:** Summary of sales attributed to each link
- **A/B Testing:** Compare performance of link variants

### Current State
| Feature | Custom Links (`/l/slug`) | User Referral (`?ref=CODE`) |
|---------|--------------------------|----------------------------|
| Click tracking | ✅ LinkVisit | ❌ None |
| Registration attribution | ✅ custom_link_id on User | ✅ Referral record |
| Purchase attribution | ✅ custom_link_id on CreditPurchase | ✅ Via Referral |
| Revenue tracking | ✅ Admin analytics | ❌ Not exposed to user |
| User-facing analytics | Admin only | Basic (referred, purchased, credits) |

### Deliverables
1. **Trackable referral URLs** – `/r/[code]` route that records clicks before redirecting to register
2. **Extended referral API** – clicks, registrations, purchases, revenue per link
3. **User referral dashboard** – full funnel metrics (clicks → regs → purchases → revenue)
4. **Admin referral overview** – aggregate stats across all referrers
5. **A/B testing** – variant assignment and per-variant analytics

---

## 2. Senior Developer – Technical Design

### Database Changes
- **referral_link_visits** – `referrer_id`, `ip_address`, `user_agent`, `referer`, `variant_key`, `created_at`
- **referral_link_variants** (A/B) – `referrer_id`, `variant_key`, `name`, `utm_params` (JSON), `created_at`

### API Additions
- `GET /api/public/referral/:code` – validate code, track visit, return redirect URL (and variant if A/B)
- `GET /api/referral/me` – extend response with `clicks`, `revenue`, `dailyClicks`, `variants`
- `GET /api/referral/variants` – list/create variants for A/B (optional phase 2)
- `GET /api/admin/referral-analytics` – admin overview of all referrers

### Flow
1. User shares `https://site.com/r/ABC123` (or `?v=summer` for variant)
2. Visitor clicks → Next.js `/r/[code]` → backend `/api/public/referral/:code` → track visit → redirect to `/register?ref=ABC123`
3. Registration → Referral record (existing)
4. Purchase → Credit awarded (existing) + revenue attributed to referrer

### Security
- Rate limit public referral endpoint
- Validate referral code exists before tracking
- No PII in visit logs (IP hashed or truncated for GDPR if needed later)

---

## 3. UI Designer – Visual Guidelines

Per Uncodixfy skill:
- **Cards:** 8–12px radius, subtle borders, no floating effects
- **Typography:** Clear hierarchy, no eyebrow labels, no decorative copy
- **Charts:** Simple bar/line, no donuts or gradient fills
- **Colors:** Use existing project palette (dark, muted)
- **Spacing:** Consistent 4/8/12/16/24px scale

### Referral Panel Enhancements
- Add **clicks** stat card
- Add **revenue** stat card (PLN)
- Add **conversion funnel** (clicks → regs → purchases)
- Add **daily clicks** mini-chart (last 7 days)
- Optional: variant selector for A/B links

---

## 4. Experimental Tracker – A/B Testing

### Variant Model
- **Default:** No variant param → `variant_key = 'default'`
- **Named variants:** `/r/CODE?v=summer` → `variant_key = 'summer'`
- **Random assignment:** Backend can assign `A` or `B` when no `v` param, store in cookie for consistency

### Metrics per Variant
- Clicks, registrations, purchases, revenue
- Conversion rates: reg/click, purchase/reg, revenue/click

### Implementation
- `referral_link_visits.variant_key` – stores which variant was shown
- Admin or user can create variants (e.g. `summer`, `winter`) and compare

---

## 5. Evidence Collector – Quality Checklist

- [ ] Migration runs without errors
- [ ] `/r/[code]` redirects correctly and tracks visits
- [ ] Referral API returns clicks, revenue
- [ ] Referral panel displays new stats
- [ ] Existing flows (register with ref, purchase) unchanged
- [ ] Rate limiting on public endpoint
- [ ] No regression in custom links or admin analytics

---

## 6. Reality Checker – Readiness

| Item | Status |
|------|--------|
| DB migrations | Ready |
| Backend endpoints | Ready |
| Frontend routes | Ready |
| UI components | Ready |
| A/B infrastructure | Ready (basic) |
| Tests | Manual verification |
| Documentation | This plan |

**Recommendation:** Deploy to staging first. Monitor referral_link_visits table growth. Consider adding TTL/archival for old visits if volume is high.
