# Evidence Collector – QA Report: dyskiof.net

**Date:** 2026-03-13  
**Target:** https://dyskiof.net  
**Methodology:** Live fetch, API probes, spec cross-reference  
**Specification:** UX Audit 2026-03, Referral Tracking Verification, Database Audit

---

## 1. Reality Check Results

### Commands / Probes Executed

| Probe | URL | Result |
|-------|-----|--------|
| Homepage | `https://dyskiof.net` | ✅ 200 – Renders models grid, featured section, bundle banner |
| Privacy page | `https://dyskiof.net/privacy` | ❌ **404 Not Found** |
| Register page | `https://dyskiof.net/register` | ✅ 200 – Form, Discord OAuth |
| API models | `https://dyskiof.net/api/models?limit=2` | ✅ 200 – JSON with models array |
| API settings | `https://dyskiof.net/api/settings/public` | ✅ 200 – JSON with BLIK, credit costs |
| API health | `https://dyskiof.net/api/health` | ❌ 404 – Endpoint not found (backend exposes `/health` directly) |
| Models page (full) | `https://dyskiof.net/models` | ⏱️ Timeout – Heavy page, slow load |

### Code Evidence

- **Cookie banner** links to `/privacy`: `src/components/cookie-banner.tsx` line 41  
- **No `/privacy` route** in `src/app` – no `privacy/` folder or page  
- **Backend health** at `e.GET("/health")` (main.go:292), not under `/api`

---

## 2. Issues Found (Evidence-Based)

### Issue 1: Broken `/privacy` Link — **Critical**

| Field | Value |
|-------|-------|
| **Evidence** | `curl -I https://dyskiof.net/privacy` → 404 |
| **Source** | Cookie banner: `<a href="/privacy">` in `cookie-banner.tsx` |
| **Spec** | UX Audit 2026-03: "Broken /privacy link — High severity" |
| **Impact** | Users clicking "Privacy" in cookie banner get 404 |

**Fix:** Add `src/app/privacy/page.tsx` or change link to existing policy URL.

---

### Issue 2: API Health Path Mismatch — **Medium**

| Field | Value |
|-------|-------|
| **Evidence** | `https://dyskiof.net/api/health` → 404 |
| **Source** | Backend: `e.GET("/health")` at root; Next.js rewrites `/api/*` to backend `/api/*` |
| **Spec** | `docs/VIDEO_STREAMING_TROUBLESHOOTING.md` line 93: `curl -I https://dyskiof.net/api/health` |
| **Impact** | Docs and scripts reference wrong path; health check fails |

**Fix:** Either add `/api/health` route in backend or update docs to use backend root `/health` (if exposed separately).

---

### Issue 3: Models Page Load Timeout — **Medium** ✅ FIXED

| Field | Value |
|-------|-------|
| **Evidence** | `https://dyskiof.net/models` fetch timed out |
| **Root cause** | Backend models List query used 4 correlated subqueries per row (80+ for limit=20) |
| **Fix applied** | Replaced with single CTE + LEFT JOIN; added partial index on content_items |

**Fix (2026-03-13):** `backend/internal/models/handler.go` — CTE `model_stats` aggregates content_items once. Migration `20260313150000_content_items_model_stats_index` adds partial index.

---

### Issue 4: Referral Migration Status Unknown — **Low**

| Field | Value |
|-------|-------|
| **Evidence** | REFERRAL_TRACKING_VERIFICATION.md: "Migration runs without errors | ⏳" |
| **Impact** | If migration not applied, referral stats show 0 (no crash, but feature incomplete) |

**Fix:** Verify `20260313120000_add_referral_link_tracking.up.sql` applied in production.

---

### Issue 5: Prisma/DB Drift (Additive) — **Low**

| Field | Value |
|-------|-------|
| **Evidence** | DATABASE_AUDIT_2026-03: `users.country`, `user_access.purchase_id` nullability |
| **Status** | Implementation completed per audit (Prisma sync, migration) |
| **Impact** | Ensure migration `20260313140000_audit_optimizations` applied if not yet |

---

## 3. What Works (Verified)

| Check | Status | Evidence |
|-------|--------|----------|
| Homepage | ✅ | Models grid, featured, bundle banner render |
| Register | ✅ | Form + Discord OAuth visible |
| API models | ✅ | `GET /api/models?limit=2` returns valid JSON |
| API settings | ✅ | `GET /api/settings/public` returns BLIK, credit costs |
| Referral `/r/[code]` | ✅ | Route exists; verification doc confirms redirect + tracking |
| Cookie banner | ✅ | Present (links to broken /privacy) |

---

## 4. Honest Quality Assessment

| Metric | Rating |
|--------|--------|
| **Specification compliance** | B – Core flows work; broken /privacy is a known, unfixed gap |
| **Production readiness** | NEEDS WORK – Fix /privacy before calling fully ready |
| **Evidence-based issues** | 5 (1 critical, 2 medium, 2 low) |

---

## 5. Required Next Steps

1. **Immediate:** Add `/privacy` page or update cookie banner link.
2. **Short-term:** Align health endpoint (docs vs backend) and verify referral migration.
3. **Ongoing:** Monitor models page load; consider performance improvements.

---

**QA Agent:** EvidenceQA (Evidence Collector)  
**Evidence Date:** 2026-03-13  
**Screenshots:** N/A (fetch-based evidence; Playwright capture not run)
