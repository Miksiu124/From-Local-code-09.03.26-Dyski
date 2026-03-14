# Lighthouse Product Brief — Mobile Optimization

**Date:** March 14, 2026  
**Scope:** dyskiof.net (ContentManager)  
**Context:** Mobile, Slow 4G (per user screenshots); Desktop run via MCP

---

## Executive Summary

Lighthouse audits (a11y, best-practices, SEO) and performance trace were run. Current state is **improved** vs. user screenshots (A11y 96, BP 96, SEO 100), but **2 audits still fail** and performance has clear improvement opportunities.

---

## Findings

### Failed Audits (2)

| Audit | Impact | Fix Owner |
|-------|--------|-----------|
| **errors-in-console** | Best Practices score | Backend: 401 auth/me, 404 models, 429 rate limit — browser logs failed fetches |
| **color-contrast** | Accessibility score | Frontend: 3 elements below 4.5:1 |

### Color Contrast Failures

1. **Register button** (`Zarejestruj się`) — `#fafafa` on `#8b5cf6` = 4.05:1 (need 4.5:1)
2. **Filter button** (`Wszystkie`) — same primary/foreground
3. **Footer text** — `#616167` on `#020202` = 3.37:1 (need 4.5:1)

### Performance (from trace)

- **LCP:** 1.7s (good)
- **Document latency:** ~814ms savings possible
- **Image delivery:** ~100KB wasted
- **Cache:** ~60KB wasted

---

## Senior Product Manager — Instructions for Senior Developer

### Priority 1 (Ship-blocking)

1. **Fix color contrast**
   - Primary buttons: use darker purple (`#7c3aed`) so `#fafafa` meets 4.5:1
   - Footer: use `text-muted-foreground` (no /60) or lighter shade for 4.5:1 on `#020202`

2. **`robots.txt`**
   - `app/robots.ts` already exists and returns valid rules; no change needed

### Priority 2 (High)

3. **Reduce console errors**
   - Auth: consider backend returning 200 + `{ user: null }` for unauthenticated instead of 401 (reduces console noise)
   - Model 404/429: ensure RetryImage/fallback handles failures without logging; or suppress expected errors in fetch (optional)

4. **Performance**
   - Document latency: reduce TTFB (server/CDN, caching)
   - Image delivery: ensure WebP/AVIF, responsive sizes, lazy loading
   - Cache: set appropriate Cache-Control headers for static assets

### Priority 3 (Nice-to-have)

5. **Accessibility**
   - Add `aria-label` to user menu button (e.g. "User menu")

---

## Verification

- **Evidence:** Re-run Lighthouse after changes; confirm errors-in-console and color-contrast pass or improve
- **Performance:** Re-run performance trace; LCP should improve or stay stable
- **Code review:** Ensure no regressions, security, or accessibility regressions

---

## Out of Scope (for this sprint)

- Deprecated APIs (3) — requires dependency audit
- Back/forward cache restoration — requires investigation of page lifecycle
