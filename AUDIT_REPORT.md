# Dyskiof Content Manager — Interface Quality Audit

**Date:** March 14, 2026  
**Scope:** ContentManager frontend (Next.js 16, React 19, Tailwind 4)

---

## Anti-Patterns Verdict

**FAIL.** The interface exhibits multiple AI-generated design tells. If shown to someone and asked "AI made this," they would likely agree.

### Specific AI Slop Tells

| Anti-Pattern | Location | Evidence |
|--------------|----------|----------|
| **Purple-to-blue gradients** | `globals.css`, multiple components | `hero-gradient` uses `rgba(139,92,246)` + `rgba(59,130,246)`; purple accent on dark throughout |
| **Gradient text for impact** | `header.tsx`, `globals.css` | Logo: `bg-gradient-to-r from-primary via-purple-400 to-primary bg-clip-text`; `.text-gradient-primary` |
| **Glassmorphism everywhere** | 20+ components | `glass-panel`, `backdrop-blur-xl` on cards, header, dropdowns, auth forms, cookie banner |
| **Dark mode with glowing accents** | `globals.css`, buttons, cards | `.glow-sm/md/lg`, `pulseGlow`, `card-hover` purple glow, primary shadow on buttons |
| **Hero metric layout** | `admin/analytics/page.tsx` | StatCard: icon + label + big number + sub stat — classic template |
| **Identical card grids** | Dashboard, analytics | Same-sized cards, icon + heading + text, repeated structure |
| **Gray text on colored backgrounds** | Various | `text-muted-foreground` on dark cards; can appear washed out |
| **Rounded elements with thick colored border** | Auth icon containers | `rounded-2xl bg-gradient-to-br from-primary/20 to-purple-600/20 border border-primary/20` |
| **Pure black background** | `globals.css` | `--color-background: #020202` — pure black never appears in nature |
| **Generic font** | `layout.tsx` | Outfit — acceptable but increasingly common in AI output |

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total issues** | 32 |
| **Critical** | 4 |
| **High** | 8 |
| **Medium** | 12 |
| **Low** | 8 |
| **Overall quality** | 5/10 — functional but visually generic |

### Top 5 Critical Issues

1. **Div used as button** — Content grid items use `<div onClick>` instead of `<button>` or keyboard-focusable element; blocks keyboard/screen reader users.
2. **Form labels not associated** — No `htmlFor`/`id` on any form; violates WCAG 1.3.1.
3. **Touch targets below 44px** — Carousel indicators (6px), favorite button, mobile menu toggle.
4. **Missing reduced-motion support** — No `prefers-reduced-motion` handling; animations can trigger vestibular issues.

### Recommended Next Steps

1. Fix critical accessibility blockers (div-as-button, form labels, touch targets).
2. Add `prefers-reduced-motion` media query.
3. Replace AI slop patterns with distinctive design choices (use `/colorize`, `/distill`, `/quieter`).
4. Normalize theming and fix hard-coded colors.

---

## Detailed Findings by Severity

### Critical Issues

#### C1. Div used as interactive control (not keyboard accessible)

- **Location:** `model-detail.tsx` lines 848–852
- **Severity:** Critical
- **Category:** Accessibility
- **Description:** Content grid items use `<div onClick={() => handleContentClick(item.id)}>` with `cursor-pointer`. Divs are not focusable; keyboard and screen reader users cannot activate them.
- **Impact:** Users who rely on keyboard or assistive tech cannot navigate to content items.
- **WCAG:** 2.1.1 Keyboard (Level A)
- **Recommendation:** Use `<button>` or make the div `tabIndex={0}` with `role="button"` and `onKeyDown` for Enter/Space. Prefer wrapping in `<Link>` if navigation is the primary action.
- **Suggested command:** `/harden`

---

#### C2. Form labels not associated with inputs

- **Location:** `login/register/forgot-password/reset-password`, `dashboard`, `admin/*`, `currency-converter`, `custom-links-client`
- **Severity:** Critical
- **Category:** Accessibility
- **Description:** Labels use `<label className="...">` but no `htmlFor` and inputs have no matching `id`. Labels are visually adjacent but not programmatically associated.
- **Impact:** Screen readers cannot associate labels with inputs; form completion is harder for assistive tech users.
- **WCAG:** 1.3.1 Info and Relationships (Level A), 3.3.2 Labels or Instructions (Level AA)
- **Recommendation:** Add unique `id` to each input and `htmlFor={id}` to its label.
- **Suggested command:** `/harden`

---

#### C3. Touch targets below 44×44px

- **Location:** 
  - `models-grid.tsx` lines 419–424: Carousel indicators `h-1.5 w-1.5` / `w-6 h-1.5` (6px height)
  - `model-detail.tsx` line 912: Favorite button `p-1.5` (~24px)
  - `header.tsx` line 257: Mobile menu toggle `p-1.5`
  - `favorites-grid.tsx` line 225: Favorite button `p-1.5`
- **Severity:** Critical
- **Category:** Responsive / Accessibility
- **Description:** Interactive elements are smaller than 44×44px, the minimum recommended for touch.
- **Impact:** Mobile users and users with motor impairments struggle to tap accurately.
- **WCAG:** 2.5.5 Target Size (Level AAA), Apple HIG / Material touch target guidelines
- **Recommendation:** Increase padding to achieve at least 44×44px; use `min-w-[44px] min-h-[44px]` or equivalent.
- **Suggested command:** `/adapt`

---

#### C4. No reduced-motion support

- **Location:** `globals.css`, all Framer Motion usage
- **Severity:** Critical
- **Category:** Accessibility
- **Description:** No `prefers-reduced-motion: reduce` handling. Animations (fadeIn, slideUp, pulseGlow, float, Framer Motion height/opacity) run unconditionally.
- **Impact:** Users with vestibular disorders or motion sensitivity can experience nausea, dizziness, or headaches.
- **WCAG:** 2.3.3 Animation from Interactions (Level AAA)
- **Recommendation:** Add `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }` and pass `reduceMotion: true` to Framer Motion where available.
- **Suggested command:** `/harden`

---

### High-Severity Issues

#### H1. Empty or poor alt text on content images

- **Location:** `model-detail.tsx` line 858 (`alt=""`), `content-viewer.tsx` line 346 (`alt=""`)
- **Severity:** High
- **Category:** Accessibility
- **Description:** Content thumbnails use `alt=""` (treating them as decorative). These are meaningful content previews.
- **Impact:** Screen reader users get no information about the content they're browsing.
- **WCAG:** 1.1.1 Non-text Content (Level A)
- **Recommendation:** Use descriptive alt, e.g. `alt={item.name || `${contentType} thumbnail`}`.
- **Suggested command:** `/harden`

---

#### H2. Decorative images without alt=""

- **Location:** `video-player.tsx` lines 688, 697: `alt=""` on seek icons
- **Severity:** High (if icons convey meaning)
- **Category:** Accessibility
- **Description:** Seek icons use `alt=""`. Buttons have `aria-label`, so alt="" is correct for decorative img. However, using `<img>` for icons is suboptimal — SVG or icon component would be better.
- **Impact:** Minor — aria-label covers the button, but img adds unnecessary request.
- **Recommendation:** Replace with inline SVG or Lucide icon to avoid extra requests and improve semantics.
- **Suggested command:** `/optimize`, `/polish`

---

#### H3. Animating height (layout thrashing)

- **Location:** `header.tsx` lines 270–272, `credit-purchase-flow.tsx` lines 487, 694
- **Severity:** High
- **Category:** Performance
- **Description:** Framer Motion `animate={{ height: "auto" }}` triggers layout reflows. Animating `height` is expensive and can cause jank on low-end devices.
- **Impact:** Stuttery animations, especially on mobile.
- **Recommendation:** Use `grid-template-rows: 0fr` → `1fr` or `overflow: hidden` + `max-height` transitions instead of animating height directly.
- **Suggested command:** `/optimize`, `/animate`

---

#### H4. Video player aria-labels in Polish

- **Location:** `video-player.tsx` lines 686, 695: `aria-label="Cofnij 10 sekund"`, `aria-label="Przewiń 10 sekund"`
- **Severity:** High
- **Category:** Accessibility
- **Description:** Seek buttons use hard-coded Polish labels while the app supports en/pl via next-intl.
- **Impact:** English users hear Polish labels from screen readers.
- **Recommendation:** Use `useTranslations()` for aria-labels.
- **Suggested command:** `/harden`

---

#### H5. Hard-coded colors bypass design tokens

- **Location:** `custom-links-client.tsx` line 371: `bg-white text-black`; `admin-payments-list.tsx`, `dashboard`, etc.: `text-white`, `bg-white`, `bg-black`
- **Severity:** High
- **Category:** Theming
- **Description:** Components use raw `white`/`black` instead of `foreground`/`background` tokens. Custom-links uses `bg-white text-black` for a light button.
- **Impact:** Breaks if theme changes; inconsistent with design system.
- **Recommendation:** Use `bg-foreground text-background` or equivalent tokens.
- **Suggested command:** `/normalize`

---

#### H6. Focus styles inconsistent

- **Location:** `dashboard/page.tsx`: inputs use `focus:ring-2 focus:ring-primary/30`; `ui/input.tsx` and `ui/button.tsx` use `focus-visible:ring-2`
- **Severity:** High
- **Category:** Accessibility
- **Description:** Dashboard uses `focus:` (shows on mouse click); UI components use `focus-visible:` (keyboard only). Inconsistent behavior.
- **Impact:** Mouse users may see unnecessary focus rings; keyboard users need consistent visible focus.
- **Recommendation:** Standardize on `focus-visible:` for all interactive elements; ensure `*:focus:not(:focus-visible) { outline: none }` in globals.
- **Suggested command:** `/normalize`

---

#### H7. Dropdown overlay uses div with onClick (keyboard trap risk)

- **Location:** `model-detail.tsx` line 791: `<div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} />`
- **Severity:** High
- **Category:** Accessibility
- **Description:** Click-outside overlay is a non-focusable div. Focus may land on the dropdown; Escape key handling not verified.
- **Impact:** Keyboard users may not be able to close the menu without clicking.
- **Recommendation:** Add `onKeyDown` for Escape, ensure focus management (focus trap or return focus on close).
- **Suggested command:** `/harden`

---

#### H8. Hero carousel prev/next buttons lack aria-labels

- **Location:** `models-grid.tsx` lines 357–361
- **Severity:** High
- **Category:** Accessibility
- **Description:** `<button onClick={goPrev}>` and `<button onClick={goNext}>` have no `aria-label`.
- **Impact:** Screen reader users hear "button" with no context.
- **Recommendation:** Add `aria-label={t("carousel.prev")}` and `aria-label={t("carousel.next")}`.
- **Suggested command:** `/harden`

---

### Medium-Severity Issues

#### M1. Glassmorphism overuse (AI slop)

- **Location:** 20+ components (header, cards, dropdowns, auth forms, cookie banner, dashboard)
- **Severity:** Medium
- **Category:** Anti-Patterns
- **Description:** `backdrop-blur` and translucent panels used decoratively throughout.
- **Impact:** Generic "AI" look; can hurt performance on low-end devices.
- **Recommendation:** Replace with solid surfaces where blur adds no functional value.
- **Suggested command:** `/distill`, `/quieter`

---

#### M2. Gradient text on logo

- **Location:** `header.tsx` line 130
- **Severity:** Medium
- **Category:** Anti-Patterns
- **Description:** Logo uses `bg-gradient-to-r from-primary via-purple-400 to-primary bg-clip-text text-transparent`.
- **Impact:** Decorative gradient text is a common AI tell.
- **Recommendation:** Use solid primary color.
- **Suggested command:** `/colorize`, `/quieter`

---

#### M3. Purple/blue AI color palette

- **Location:** `globals.css`, hero-gradient, buttons, glows
- **Severity:** Medium
- **Category:** Anti-Patterns
- **Description:** Dark background + purple primary + blue accent is a stereotypical AI palette.
- **Impact:** Interface feels generic and forgettable.
- **Recommendation:** Explore a more distinctive palette (e.g. warm accents, muted tones, or brand-specific colors).
- **Suggested command:** `/colorize`, `/critique`

---

#### M4. StatCard hero-metric pattern

- **Location:** `admin/analytics/page.tsx` lines 59–71
- **Severity:** Medium
- **Category:** Anti-Patterns
- **Description:** Icon + label + big number + sub stat in identical cards.
- **Impact:** Template-like layout.
- **Recommendation:** Vary layout, hierarchy, or visual treatment.
- **Suggested command:** `/bolder`, `/distill`

---

#### M5. Dashboard credit balance as hero metric

- **Location:** `dashboard/page.tsx` lines 325–340
- **Severity:** Medium
- **Category:** Anti-Patterns
- **Description:** Big number (`text-2xl sm:text-3xl font-bold text-white`) with label below in glass panel.
- **Impact:** Matches "hero metric" template.
- **Recommendation:** Integrate balance into a more natural layout.
- **Suggested command:** `/distill`

---

#### M6. RetryImage uses native img without loading="lazy" by default

- **Location:** `retry-image.tsx` — `loading` not passed through; `models-grid.tsx` hero uses `motion.img` without lazy
- **Severity:** Medium
- **Category:** Performance
- **Description:** Hero carousel uses `motion.img` with no `loading="lazy"`; above-the-fold images load eagerly. RetryImage doesn't default to lazy.
- **Impact:** Slower LCP on models page.
- **Recommendation:** Add `loading="lazy"` to below-fold RetryImage; consider `loading="eager"` only for first hero image.
- **Suggested command:** `/optimize`

---

#### M7. Fixed width on side list

- **Location:** `models-grid.tsx` line 438: `w-[260px]`
- **Severity:** Medium
- **Category:** Responsive
- **Description:** Side list items have fixed `w-[260px]` on mobile; with `flex-shrink-0` can cause horizontal scroll.
- **Impact:** Awkward horizontal scroll on narrow viewports.
- **Recommendation:** Use `min-w-[200px]` or responsive widths.
- **Suggested command:** `/adapt`

---

#### M8. Video player controls shrink on desktop

- **Location:** `video-player.tsx` lines 681, 691: `sm:p-0 sm:w-9 sm:h-9 sm:min-w-0 sm:min-h-0`
- **Severity:** Medium
- **Category:** Responsive
- **Description:** Seek buttons are 48×48 on mobile (good) but 36×36 on desktop. Touch target guidance applies to all pointer types in some guidelines.
- **Impact:** Smaller targets for desktop users with motor impairments.
- **Recommendation:** Consider keeping 44px minimum across breakpoints.
- **Suggested command:** `/adapt`

---

#### M9. Pure black background

- **Location:** `globals.css` line 4: `--color-background: #020202`
- **Severity:** Medium
- **Category:** Theming / Anti-Patterns
- **Description:** Near-pure black; frontend-design skill advises against pure black.
- **Impact:** Harsh contrast; can feel sterile.
- **Recommendation:** Use a slightly tinted dark (e.g. `#0c0c0f` or oklch).
- **Suggested command:** `/colorize`, `/normalize`

---

#### M10. Custom-links modal uses div overlay

- **Location:** `custom-links-client.tsx` lines 329, 383
- **Severity:** Medium
- **Category:** Accessibility
- **Description:** Modal overlay is a `div` with `fixed inset-0`; may not have proper `role="dialog"`, `aria-modal`, or focus trap.
- **Impact:** Screen reader and keyboard users may have poor modal experience.
- **Recommendation:** Use Dialog component or ensure ARIA and focus management.
- **Suggested command:** `/harden`

---

#### M11. Cookie banner aria-label only

- **Location:** `cookie-banner.tsx` line 36
- **Severity:** Medium
- **Category:** Accessibility
- **Description:** Has `aria-label` and `role="dialog"` but may lack `aria-describedby` for content and proper focus management.
- **Impact:** Incomplete dialog semantics.
- **Recommendation:** Add `aria-describedby` pointing to main message; ensure focus trap.
- **Suggested command:** `/harden`

---

#### M12. Inconsistent error/success colors

- **Location:** `dashboard/page.tsx` StatusMessage uses `bg-green-500/10`, `bg-red-500/10`; login uses `bg-destructive/10`, `bg-green-500/10`
- **Severity:** Medium
- **Category:** Theming
- **Description:** Mix of raw green/red and design tokens (`destructive`).
- **Impact:** Inconsistent theming; success has no token.
- **Recommendation:** Add `--color-success` usage; use tokens consistently.
- **Suggested command:** `/normalize`

---

### Low-Severity Issues

#### L1. Carousel indicators could be buttons with aria-label

- **Location:** `models-grid.tsx` lines 417–424
- **Severity:** Low
- **Category:** Accessibility
- **Description:** Indicators are `<button>` but lack `aria-label` (e.g. "Slide 2 of 5") and `aria-current` for active.
- **Recommendation:** Add `aria-label` and `aria-current="true"` for active indicator.
- **Suggested command:** `/polish`

---

#### L2. Redundant stagger animation classes

- **Location:** `model-detail.tsx` line 850: `stagger-${Math.min(index % 10 + 1, 10)}`
- **Severity:** Low
- **Category:** Performance
- **Description:** Dynamic class names may prevent style reuse.
- **Recommendation:** Use data attributes or CSS `:nth-child` for stagger.
- **Suggested command:** `/optimize`

---

#### L3. Scrollbar styling webkit-only

- **Location:** `globals.css` lines 76–93
- **Severity:** Low
- **Category:** Theming
- **Description:** Custom scrollbar uses `::-webkit-scrollbar`; Firefox uses different properties.
- **Impact:** Inconsistent scrollbar appearance in Firefox.
- **Recommendation:** Add `scrollbar-width` and `scrollbar-color` for Firefox.
- **Suggested command:** `/polish`

---

#### L4. Card-hover disabled on touch

- **Location:** `globals.css` lines 197–201
- **Severity:** Low
- **Category:** Responsive
- **Description:** `@media (hover: none)` removes card hover lift. Correct for hover, but touch users get no feedback.
- **Impact:** Touch users have no press/active feedback on cards.
- **Recommendation:** Add `:active` state for touch feedback.
- **Suggested command:** `/adapt`

---

#### L5. Duplicate hero-gradient usage

- **Location:** Login, register, forgot-password, reset-password, verify-email
- **Severity:** Low
- **Category:** Theming
- **Description:** Same `hero-gradient` and icon container pattern repeated.
- **Impact:** Code duplication; harder to change globally.
- **Recommendation:** Extract shared auth layout component.
- **Suggested command:** `/extract`

---

#### L6. Favicon uses "V" placeholder

- **Location:** `public/favicon.svg`
- **Severity:** Low
- **Category:** Branding
- **Description:** Favicon shows "V" in Arial; likely placeholder for "Dyskiof".
- **Recommendation:** Replace with proper brand mark.
- **Suggested command:** Manual / design

---

#### L7. Some buttons lack disabled state styling

- **Location:** Various custom buttons (e.g. model-detail purchase buttons)
- **Severity:** Low
- **Category:** Accessibility
- **Description:** `disabled` buttons may not have clear visual difference beyond `opacity-50`.
- **Recommendation:** Ensure `aria-disabled` and clear disabled styling.
- **Suggested command:** `/polish`

---

#### L8. No skip link

- **Location:** `layout.tsx`
- **Severity:** Low
- **Category:** Accessibility
- **Description:** No "Skip to main content" link for keyboard users.
- **Impact:** Keyboard users must tab through full header to reach main content.
- **Recommendation:** Add skip link as first focusable element.
- **Suggested command:** `/harden`

---

## Patterns & Systemic Issues

1. **Glassmorphism** — Used in 20+ components. Consider replacing with solid surfaces for performance and distinctiveness.
2. **Form labels** — No `htmlFor`/`id` association in any form across the app.
3. **Touch targets** — Multiple interactive elements under 44px (carousel indicators, favorite buttons, mobile menu).
4. **Div as button** — At least one critical case (content grid); other clickable divs may exist.
5. **Hard-coded colors** — `text-white`, `bg-white`, `bg-black` used instead of design tokens in several places.
6. **No reduced motion** — No `prefers-reduced-motion` handling anywhere.
7. **AI color palette** — Purple/blue on dark is used consistently; contributes to generic look.

---

## Positive Findings

- **Focus-visible** — `*:focus:not(:focus-visible) { outline: none }` in globals; Button and Input use `focus-visible:ring`.
- **Design tokens** — `@theme` in globals.css defines a coherent token set.
- **Video player** — Good `aria-label` coverage, `role="application"`, and 48×48 touch targets on mobile.
- **RetryImage** — Retry logic and fallback improve resilience.
- **Semantic structure** — Many pages use proper headings and landmarks.
- **Cookie banner** — Has `role="dialog"` and `aria-label`.
- **next-intl** — i18n in place for en/pl.
- **CVA for buttons** — Clear variant system.
- **Security headers** — next.config includes CSP, HSTS, etc.

---

## Recommendations by Priority

### Immediate (Critical)

1. Replace div-as-button in content grid with keyboard-accessible control.
2. Associate all form labels with inputs via `htmlFor`/`id`.
3. Increase touch targets to ≥44×44px for carousel indicators, favorite buttons, mobile menu toggle.
4. Add `prefers-reduced-motion` support.

### Short-term (High)

1. Add descriptive alt text to content thumbnails.
2. Replace height animation with grid-template-rows or overflow-based approach.
3. Localize video player aria-labels.
4. Replace hard-coded white/black with design tokens.
5. Standardize focus styles on `focus-visible`.
6. Fix dropdown overlay keyboard handling.

### Medium-term (Medium)

1. Reduce glassmorphism; use solid surfaces.
2. Replace gradient text on logo with solid color.
3. Revisit color palette for distinctiveness.
4. Vary StatCard and dashboard layout.
5. Add `loading="lazy"` to below-fold images.
6. Fix fixed width on models side list.
7. Add success color token and use consistently.

### Long-term (Low)

1. Add skip link.
2. Improve carousel indicator semantics.
3. Add Firefox scrollbar styling.
4. Add touch feedback for cards.
5. Extract shared auth layout.
6. Update favicon.

---

## Suggested Commands for Fixes

| Command | Addresses |
|---------|-----------|
| `/harden` | C1, C2, C4, H1, H4, H7, H8, M10, M11, L8 — accessibility, resilience |
| `/adapt` | C3, M7, M8, L4 — responsive, touch targets |
| `/normalize` | H5, H6, M9, M12 — theming, design tokens |
| `/optimize` | H3, M6, L2 — performance |
| `/distill` | M1, M2, M4, M5 — anti-patterns, simplification |
| `/colorize` | M2, M3, M9 — palette, distinctiveness |
| `/quieter` | M1, M2 — tone down AI slop |
| `/polish` | H2, L1, L3, L7 — refinements |
| `/extract` | L5 — component reuse |

---

*Audit complete. Use the suggested commands to address issues systematically.*
