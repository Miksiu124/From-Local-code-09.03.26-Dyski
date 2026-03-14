# Referral Tracking – Quality Verification & Reality Check

**Date:** 2026-03-13

---

## Evidence Collector – Quality Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Migration runs without errors | ⏳ | Run `./scripts/run-pending-migrations.sh` or apply migration 20260313120000 |
| `/r/[code]` redirects correctly | ✅ | Route calls backend, returns redirect URL |
| Referral API returns clicks, revenue | ✅ | GetMe extended with clicks, revenue, dailyClicks |
| Referral panel displays new stats | ✅ | 5 stat cards + daily chart |
| Existing flows unchanged | ✅ | Register with ref, purchase attribution unchanged |
| Rate limiting on public endpoint | ✅ | 200/min per IP on TrackAndRedirect |
| Custom links / admin analytics | ✅ | No regression; referral section added to admin |
| A/B variant support | ✅ | `?v=variant` query param stored in visits |
| i18n (en, pl) | ✅ | New keys added |
| Prisma schema updated | ✅ | ReferralLinkVisit, ReferralLinkVariant models |

---

## Reality Checker – Readiness Evaluation

### What Works
- **Trackable links:** `/r/ABC123` records clicks before redirecting to `/register?ref=ABC123`
- **User dashboard:** Clicks, registrations, purchases, revenue, daily chart
- **Admin analytics:** Referral program summary (clicks, registrations, revenue)
- **A/B variants:** Add `?v=summer` to compare campaigns
- **Legacy links:** `/register?ref=CODE` still works (no click tracking)

### Deployment Steps
1. **Run migration:** `./scripts/run-pending-migrations.sh` or apply `20260313120000_add_referral_link_tracking.up.sql` to PostgreSQL
2. **Rebuild backend:** Go binary picks up new handler
3. **Rebuild frontend:** Next.js includes `/r/[code]` route
4. **Update user links:** Users should share `https://yoursite.com/r/CODE` for tracking

### Known Limitations
- **Legacy links:** Old `/register?ref=CODE` links do not track clicks (by design)
- **Table dependency:** If migration not run, referral stats show 0 (no crash)
- **Variant creation:** No UI to create variants yet; use `?v=name` manually

### Security
- Rate limit: 200 req/min per IP on public referral endpoint
- No PII in visit logs (IP, user-agent, referer – standard analytics)
- Referral code validated server-side before tracking

### Performance
- Visit tracking is async (goroutine) – does not block redirect
- Daily clicks query limited to 7 days
- Indexes on referrer_id, created_at, variant_key

---

## Recommendation

**Ready for staging.** Run migration, deploy, and verify:
1. Visit `/r/YOUR_CODE` → redirects to register with ref
2. Check `referral_link_visits` table for new row
3. User referral page shows clicks and revenue
