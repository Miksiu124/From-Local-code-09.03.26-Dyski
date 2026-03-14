# Senior Product Manager — Remediation Plan

**Date:** March 14, 2026  
**Scope:** dyskiof.net (ContentManager)  
**Sources:** Web performance audit, Lighthouse Product Brief, AUDIT_REPORT.md, user feedback (navigation delay)

---

## Executive Summary

This plan addresses **performance**, **accessibility**, **best-practices**, and **navigation UX**. It is ordered by impact and effort. The visible delay when navigating to the main page (`/` or `/models`) is treated as a **high-priority UX issue**, not a feature.

---

## Issue Summary

| Category | Issues |
|----------|--------|
| **Navigation delay** | Visible wait when navigating to `/` or `/models` — no loading UI, 7 blocking API calls |
| **Performance** | TTFB ~1s, LCP image missing `fetchpriority="high"`, document latency |
| **Accessibility** | Color contrast (3 elements), form labels, touch targets, div-as-button |
| **Best practices** | Console errors (401, 404, 429) |
| **SEO** | robots.txt OK |

---

## Phase 1: Navigation Delay (High Impact, Medium Effort)

**Problem:** When users click "Models" or navigate to `/`, they experience a visible delay with no feedback. The page is a Server Component that blocks on 7 parallel API calls before rendering.

**Root causes:**
1. No `loading.tsx` at the root route — users see a blank/frozen state during navigation
2. Seven API calls block render — `/models`, `/models?featured=true`, `/countries`, `/settings/public`, `/models/stats`, `/auth/me`, `/user/access`
3. API client uses `cache: "no-store"` — no server-side caching
4. `/models` redirects to `/` — extra hop; loading flashes then redirects

### Actions

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 1.1 | **Add `app/loading.tsx`** — Skeleton matching ModelsGrid layout (reuse `(user)/models/loading.tsx` design) so users see immediate feedback during navigation | Frontend | S |
| 1.2 | **Add `fetchpriority="high"`** to the hero LCP image in `models-grid.tsx` (line ~374) | Frontend | S |
| 1.3 | **Introduce server-side caching** for home page data — use `unstable_cache` or `fetch` with `next: { revalidate: 60 }` for models, countries, settings, stats (60s stale-while-revalidate). Keep `auth/me` and `user/access` uncached | Frontend | M |
| 1.4 | **Consider removing `/models` redirect** — Either serve the same content at `/models` (no redirect) or ensure the redirect is instant. If keeping redirect, ensure loading state is consistent | Frontend | S |

**Success criteria:** Navigation to `/` shows skeleton within ~100ms; perceived delay reduced by 50%+.

---

## Phase 2: Document Latency / TTFB (High Impact, Backend-Heavy)

**Problem:** TTFB ~1,001ms; document latency insight estimates ~900ms FCP/LCP savings.

### Actions

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 2.1 | **CDN caching** — Cache HTML at edge for anonymous users; bypass for authenticated | Infra/Backend | M |
| 2.2 | **Backend optimization** — Profile `/api/models`, `/api/countries`, etc.; add DB indexes, connection pooling, reduce cold-start if serverless | Backend | L |
| 2.3 | **Reduce waterfall** — Ensure API calls from Next.js hit backend in parallel; verify no unnecessary serialization | Full-stack | S |

**Success criteria:** TTFB < 600ms (good), ideally < 200ms.

---

## Phase 3: Accessibility (Ship-Blocking)

**Problem:** Color contrast fails (3 elements); form labels, touch targets, div-as-button (from AUDIT_REPORT).

### Actions

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 3.1 | **Color contrast** — Primary buttons: use `#7c3aed` so `#fafafa` meets 4.5:1; footer: lighter text for 4.5:1 on `#020202` | Frontend | S |
| 3.2 | **Form labels** — Add `id` to inputs and `htmlFor` to labels across login, register, forgot-password, reset-password, dashboard, admin, currency-converter, custom-links | Frontend | M |
| 3.3 | **Touch targets** — Ensure carousel indicators, favorite buttons, mobile menu toggle are ≥44×44px | Frontend | S |
| 3.4 | **Div-as-button** — Replace content grid `<div onClick>` with `<button>` or `role="button"` + `tabIndex={0}` + `onKeyDown` | Frontend | S |

**Success criteria:** Lighthouse color-contrast and keyboard audits pass.

---

## Phase 4: Console Errors (Best Practices)

**Problem:** 401 auth/me, 404 models, 429 rate limit — browser logs failed fetches.

### Actions

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 4.1 | **Auth/me** — Backend returns 200 + `{ user: null }` for unauthenticated instead of 401 | Backend | S |
| 4.2 | **Model 404/429** — RetryImage/fallback should handle failures without logging; or suppress expected errors in fetch | Frontend | S |
| 4.3 | **Rate limit** — Ensure Retry-After or backoff; avoid noisy console on 429 | Full-stack | S |

**Success criteria:** Lighthouse errors-in-console audit passes.

---

## Phase 5: Nice-to-Have

| # | Action | Owner |
|---|--------|-------|
| 5.1 | Add `aria-label` to user menu button | Frontend |
| 5.2 | Preload LCP image if featured model is known at build/SSR time | Frontend |
| 5.3 | `prefers-reduced-motion` support | Frontend |

---

## Implementation Order (Recommended)

```
Sprint 1 (Ship-blocking + Quick wins):
├── 1.1  app/loading.tsx
├── 1.2  fetchpriority="high" on hero image
├── 3.1  Color contrast
└── 3.3  Touch targets

Sprint 2 (Navigation + A11y):
├── 1.3  Server-side caching for home page
├── 1.4  /models redirect handling
├── 3.2  Form labels
└── 3.4  Div-as-button fix

Sprint 3 (Backend + Polish):
├── 2.1  CDN caching
├── 4.1  Auth/me 200 for unauthenticated
├── 4.2  Suppress expected fetch errors
└── 5.1  aria-label on user menu
```

---

## Verification

- **Navigation:** Measure time-to-first-content (skeleton) and time-to-interactive; target <200ms for skeleton, <2s for full content on Slow 4G
- **Performance:** Re-run Chrome DevTools performance trace; LCP stable or improved, TTFB improved
- **Accessibility:** Re-run Lighthouse a11y; color-contrast, form-labels, keyboard pass
- **Console:** No failed fetches for expected cases (unauthenticated, missing models)

---

## Out of Scope (This Plan)

- Deprecated APIs (dependency audit)
- Back/forward cache restoration
- Full design system overhaul (AI slop patterns)
