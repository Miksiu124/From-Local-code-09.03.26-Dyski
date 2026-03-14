# UX Audit — Dyskiof Content Platform

**Date:** March 2026  
**Scope:** ContentManager (Next.js) — user flows, admin, auth, purchase, content consumption

---

## Executive Summary

The platform has a solid foundation: clear information architecture, good loading states, scroll restoration, and mobile-first design. The main gaps are: broken links, inconsistent accessibility, some Codex-style UI patterns, and a few conversion friction points.

**Overall UX grade: B+** — good core flows, needs polish in accessibility, consistency, and trust.

---

## 1. Information Architecture & Navigation

### Strengths

- **Clear hierarchy:** Home → Models → Model detail → Content
- **Auth-aware nav:** Buy credits, dashboard, favorites only show when logged in
- **Admin separation:** Dedicated sidebar (desktop) and bottom nav (mobile)
- **Conditional footer:** Hidden on admin for cleaner admin UX
- **Scroll restoration:** Models list and model folders restore scroll position on back navigation

### Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| **Broken /privacy link** | High | Cookie banner links to `/privacy` but no route exists |
| **Mobile nav duplication** | Low | Favorites in both header and mobile menu; user menu links duplicated |
| **No breadcrumbs** | Low | Deep paths (e.g. `/content/[slug]/[id]`) lack breadcrumb context |

### Recommendations

1. **Add `/privacy` page** or remove/update the cookie banner link.
2. Consider breadcrumbs for: `/models/[slug]` → `/content/[slug]/[id]`.
3. Simplify mobile nav: keep one source of truth for Favorites/Dashboard.

---

## 2. Visual Design & Uncodixfy Alignment

### Current state

- **Dark theme:** `#020202` background, `#8b5cf6` primary
- **Typography:** Outfit font (layout), system fallbacks
- **Radius:** 12–16px on cards and containers

### Uncodixfy violations

| Pattern | Location | Recommendation |
|---------|----------|----------------|
| **Gradient text** | Header logo: `bg-gradient-to-r from-primary via-purple-400 to-primary` | Use solid primary color |
| **Eyebrow labels** | Dashboard: "Credit Balance", "Content Access" with `uppercase tracking-wider` | Use plain labels or remove uppercase |
| **Featured section** | "FEATURED" with `tracking-widest uppercase` | Reduce to plain "Featured" |
| **Soft gradients** | `hero-gradient` on login, bundle banner `from-primary/10 via-purple-500/10` | Use subtle borders or flat backgrounds |
| **Rounded-xl** | Many buttons and inputs use `rounded-xl` (12px) | Consider `rounded-lg` (8px) for inputs |
| **Card hover lift** | `card-hover` with `translateY(-4px)` and glow | Use subtle border change only |
| **Spring animations** | User menu, dialogs: `type: "spring", damping: 25` | Use 150–200ms ease transitions |

### What’s good

- No hero sections inside dashboards
- No pill overload (except country filters, which are intentional)
- No fake charts or decorative KPI cards
- Tables use simple borders and hover states

---

## 3. Accessibility (a11y)

### Strengths

- **Focus styles:** `focus-visible:ring-2 focus-visible:ring-primary/40` on inputs and buttons
- **Focus outline:** `*:focus:not(:focus-visible) { outline: none }` — no outline on mouse
- **Video player:** `aria-label` on play, pause, mute, volume, fullscreen
- **Cookie banner:** `role="dialog"` and `aria-label`
- **Touch targets:** 48px minimum on mobile controls (video player)

### Issues

| Issue | Severity | Location |
|-------|----------|----------|
| **Hardcoded Polish** | Medium | Video seek buttons: `aria-label="Cofnij 10 sekund"` / `"Przewiń 10 sekund"` — should use i18n |
| **Dialog close button** | Medium | No `aria-label` on X close button |
| **Dialog focus trap** | Medium | No focus trap or return focus on close |
| **Escape key** | Low | No explicit Escape-to-close on dialogs (check Radix/behavior) |
| **Notification bell** | Low | No `aria-expanded`, `aria-haspopup` for dropdown |
| **Language switcher** | Low | No `aria-label` on button |
| **Skip link** | Low | No "Skip to main content" link |

### Recommendations

1. **Add i18n for video player labels** (seek back/forward).
2. **Add `aria-label="Close"`** to dialog close buttons.
3. **Use Radix Dialog** or similar for focus trap and Escape handling.
4. **Add `aria-expanded`/`aria-haspopup`** to notification bell and user menu.
5. **Add skip link** for keyboard users: `<a href="#main">Skip to content</a>`.

---

## 4. Mobile Experience

### Strengths

- **Responsive grid:** 2–5 columns based on breakpoint
- **Bottom nav:** Admin uses fixed bottom bar on mobile
- **Touch targets:** 48px minimum on video controls
- **Swipe navigation:** Content viewer supports left/right swipe for prev/next
- **Mobile-first dialogs:** `rounded-t-2xl` on mobile, bottom sheet style
- **Safe area:** `pb-[env(safe-area-inset-bottom)]` on admin nav
- **Hover disabled:** `@media (hover: none)` disables card-hover lift on touch devices

### Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| **Main padding** | Low | `pb-24 md:pb-0` — main content has bottom padding on mobile; may hide footer content |
| ~~**Admin bottom nav**~~ | ~~Low~~ | ✅ Fixed: min-w-0, overflow-x-auto, reduced padding on 320px |
| **Featured carousel** | Low | Horizontal scroll on mobile; side cards may be hard to tap |

### Recommendations

1. Verify admin bottom nav doesn’t overflow on 320px screens.
2. Consider horizontal scroll indicators for featured side cards.
3. Test cookie banner on small screens (stack layout).

---

## 5. Conversion & Purchase Flow

### Strengths

- **Clear pricing:** Credits shown in access popup and bundle banner
- **Access popup:** Clear options (7d vs 30d), selected state, insufficient credits handling
- **Purchase page:** Balance visible, package selection, multiple payment methods
- **Payment status:** SSE for real-time updates, polling fallback

### Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| **No guest preview** | Medium | Users can’t browse content without account; may reduce conversion |
| ~~**Login redirect**~~ | ~~Low~~ | ✅ Fixed: redirect param passed to login/register, used after auth |
| **Bundle banner** | Low | "Best" badge on 30d may feel aggressive |

### Recommendations

1. **Return URL:** After login, redirect to the model/content that triggered the popup.
2. **Guest preview:** Consider blur or preview for non-logged users.
3. **Softer copy:** Replace "Best" with "Popular" or "30 days" if preferred.

---

## 6. Error Handling & Feedback

### Strengths

- **Error boundary:** Catches render errors with "Try again" option
- **Status messages:** Dashboard: success/error with inline feedback
- **Loading states:** Spinners, skeleton placeholders
- **Retry image:** Image fallback with retry logic
- **Empty states:** "No models" / "No notifications" with icons

### Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| **Silent failures** | Medium | Notification fetch, favorites toggle — no user feedback on error |
| **Hardcoded strings** | Low | "Nickname updated", "Email updated" — should use i18n |
| **Error boundary** | Low | Generic "Something went wrong" — consider adding a support link |

### Recommendations

1. **Toast or inline feedback** for notification fetch and favorites toggle failures.
2. **i18n for status messages** in dashboard.
3. **Support link** in error boundary fallback.

---

## 7. Loading & Performance

### Strengths

- **Loading skeletons:** Model detail, content pages
- **Suspense:** Next.js streaming where applicable
- **Lazy loading:** Images with `loading="lazy"`
- **Infinite scroll:** Intersection observer for models grid
- **Debounced search:** 300ms delay on model search
- **API timeouts:** 5s timeout on home page fetches with fallbacks

### Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| **Full page reload** | Low | Language switch triggers `window.location.reload` |
| **Auth check** | Low | Header fetches `/api/auth/me` on client; could add cache |

### Recommendations

1. Consider `next/navigation` for locale change without full reload (if supported).
2. Add short cache for `/api/auth/me` to avoid repeated fetches.

---

## 8. Internationalization (i18n)

### Strengths

- **next-intl** for translations
- **Language switcher** with EN/PL
- **Locale in metadata** for SEO

### Issues

| Issue | Severity | Location |
|-------|----------|----------|
| **Hardcoded Polish** | Medium | Video player seek labels |
| **Hardcoded English** | Low | Dashboard "Nickname updated", "Credit Balance", etc. |
| **Notification panel** | Low | "Notifications", "Mark all read", "No notifications" |

### Recommendations

1. Add translation keys for all user-facing strings.
2. Ensure video player labels use `useTranslations()`.

---

## 9. Trust & Security UX

### Strengths

- **Email verification:** Banner and resend flow for unverified users
- **Password confirmation:** Required for email change
- **OAuth clarity:** Clear messaging when email/password cannot be changed

### Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| **Broken privacy link** | High | Cookie banner links to non-existent `/privacy` |
| **Cookie banner** | Low | No "Reject" or "Customize" — only Accept |

### Recommendations

1. **Add `/privacy` page** or update cookie banner link.
2. Consider "Reject" / "Customize" for GDPR compliance (depending on jurisdiction).

---

## 10. Priority Action List

### High priority

1. **Add `/privacy` page** or fix cookie banner link.
2. **i18n for video player labels** (seek back/forward).
3. ~~**Return URL after login** when accessing locked content.~~ ✅ Fixed (March 2026)

### Medium priority

4. Add focus trap and aria attributes to dialogs.
5. Add toast/feedback for silent failures (notifications, favorites).
6. i18n for dashboard status messages and notification panel.
7. Reduce Uncodixfy patterns (gradient logo, eyebrow labels, card hover).

### Low priority

8. Add skip link for keyboard users.
9. Add breadcrumbs for content view.
10. Consider "Reject" for cookie banner.

---

## Appendix: Quick Reference

### Files to update

| File | Changes |
|------|---------|
| `cookie-banner.tsx` | Fix privacy link or add `/privacy` route |
| `video-player.tsx` | i18n for seek labels |
| `header.tsx` | Return URL on login redirect |
| `login/page.tsx` | Accept `redirect` param |
| `access-required-popup.tsx` | Pass `redirect` to login |
| `dashboard/page.tsx` | i18n for status messages |
| `notification-bell.tsx` | i18n, aria attributes |
| `globals.css` | Reduce card-hover, consider softer gradients |
| `layout.tsx` | Add skip link |

### Design tokens (current)

- `--radius-xl: 1rem` (16px)
- `--color-primary: #8b5cf6`
- `--color-background: #020202`
